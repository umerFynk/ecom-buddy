import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { getQueue, QUEUES } from '@/jobs/queue';

/**
 * FIFO inventory allocation. For each order item with a linked variantId we
 * pull the oldest InventoryLevel rows (one per store) and allocate against
 * them in order until the order_item.quantity is fully reserved.
 *
 * On success: order_item.allocated_qty incremented, inventory_level.allocated_stock
 * incremented, inventory_movement row written (type=allocation), and an OOS event
 * is created if any level falls at or below threshold.
 *
 * If we cannot fully allocate (insufficient stock across all stores) the order
 * stays in its current state and an OOS event is created — Phase 4/5 wires
 * notification flows.
 */

export interface AllocationResult {
  orderId: string;
  fullyAllocated: boolean;
  shortages: Array<{ variantId: string; needed: number; allocated: number }>;
}

export async function allocateForOrder(orderId: string): Promise<AllocationResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new Error(`Order ${orderId} not found`);

    const shortages: AllocationResult['shortages'] = [];

    for (const item of order.items) {
      if (!item.variantId || item.allocatedQty >= item.quantity) continue;
      let needed = item.quantity - item.allocatedQty;

      // FIFO: oldest InventoryLevel rows first across stores
      const levels = await tx.inventoryLevel.findMany({
        where: { variantId: item.variantId },
        orderBy: { lastSyncedAt: 'asc' },
      });

      let allocatedThisItem = 0;
      for (const level of levels) {
        if (needed <= 0) break;
        const available = level.totalStock - level.allocatedStock;
        if (available <= 0) continue;
        const take = Math.min(available, needed);
        await tx.inventoryLevel.update({
          where: { id: level.id },
          data: { allocatedStock: { increment: take } },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            type: 'allocation',
            quantity: take,
            orderId: order.id,
            reason: `allocate to order ${order.id}`,
          },
        });
        // queue Shopify inventory sync (best-effort, fire and forget after tx)
        scheduleShopifySync(level.storeId, level.variantId).catch(() => {});
        needed -= take;
        allocatedThisItem += take;
      }

      await tx.orderItem.update({
        where: { id: item.id },
        data: { allocatedQty: { increment: allocatedThisItem } },
      });

      if (needed > 0) {
        shortages.push({ variantId: item.variantId, needed: item.quantity, allocated: item.allocatedQty + allocatedThisItem });
      }
    }

    if (shortages.length === 0) {
      await tx.order.update({ where: { id: order.id }, data: { status: order.status === 'auto_confirmed' || order.status === 'confirmed' ? 'inventory_allocated' : order.status } });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'inventory_allocated',
          actorType: 'system',
          note: 'Inventory allocated FIFO',
        },
      });
    } else {
      // Create OOS events for the shortage items.
      const { recordOosEvent } = await import('./inventory.oos');
      for (const s of shortages) {
        await recordOosEvent(tx, order.tenantId, order.storeId, s.variantId);
      }
    }

    return { orderId, fullyAllocated: shortages.length === 0, shortages };
  });
}

/**
 * Reverse allocation when an order is cancelled or RTO'd. Best-effort —
 * we deallocate up to whatever is currently marked allocated.
 */
export async function deallocateForOrder(orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return;

    for (const item of order.items) {
      if (!item.variantId || item.allocatedQty <= 0) continue;
      let toFree = item.allocatedQty;
      const levels = await tx.inventoryLevel.findMany({
        where: { variantId: item.variantId, allocatedStock: { gt: 0 } },
        orderBy: { lastSyncedAt: 'desc' },
      });
      for (const level of levels) {
        if (toFree <= 0) break;
        const free = Math.min(level.allocatedStock, toFree);
        await tx.inventoryLevel.update({
          where: { id: level.id },
          data: { allocatedStock: { decrement: free } },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            type: 'deallocation',
            quantity: free,
            orderId: order.id,
            reason: `deallocate from order ${order.id}`,
          },
        });
        scheduleShopifySync(level.storeId, level.variantId).catch(() => {});
        toFree -= free;
      }
      await tx.orderItem.update({ where: { id: item.id }, data: { allocatedQty: { decrement: item.allocatedQty - toFree } } });
    }
  });
}

/**
 * Decrement actual stock when items physically leave the warehouse (i.e. on
 * dispatch). This converts allocated_stock into actual outflow.
 */
export async function consumeOnDispatch(orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return;

    for (const item of order.items) {
      if (!item.variantId || item.allocatedQty <= 0) continue;
      const levels = await tx.inventoryLevel.findMany({
        where: { variantId: item.variantId, allocatedStock: { gt: 0 } },
        orderBy: { lastSyncedAt: 'asc' },
      });
      let toConsume = item.allocatedQty;
      for (const level of levels) {
        if (toConsume <= 0) break;
        const take = Math.min(level.allocatedStock, level.totalStock, toConsume);
        await tx.inventoryLevel.update({
          where: { id: level.id },
          data: {
            totalStock: { decrement: take },
            allocatedStock: { decrement: take },
          },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            type: 'outbound',
            quantity: -take,
            orderId: order.id,
            reason: `dispatch ${order.id}`,
          },
        });
        scheduleShopifySync(level.storeId, level.variantId).catch(() => {});
        toConsume -= take;
      }
    }
  });
}

async function scheduleShopifySync(storeId: string, variantId: string) {
  try {
    const queue = getQueue(QUEUES.INVENTORY_SHOPIFY_SYNC);
    await queue.add(
      'sync',
      { storeId, variantId },
      { jobId: `${storeId}:${variantId}`, removeOnComplete: 100, removeOnFail: 50, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    );
  } catch (err) {
    logger.warn({ err, storeId, variantId }, 'shopify_sync_enqueue_failed');
  }
}
