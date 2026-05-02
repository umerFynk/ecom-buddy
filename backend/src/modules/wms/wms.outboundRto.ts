import { Prisma, RtoCondition } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { changeOrderStatus } from '../status/status.service';
import { dispatchNotification } from '../notifications/notifications.service';

/**
 * Outbound batch from the warehouse — we delegate the courier booking +
 * load sheet PDF to the existing Phase 3 dispatch flow. Here we just
 * gather the packed orders and hand them to that pipeline.
 */
export async function listOutboundQueue(opts: { courierType?: string }) {
  return prisma.order.findMany({
    where: {
      status: 'inventory_allocated',
      packTasks: { some: { status: 'packed' } },
      ...(opts.courierType ? { courierType: opts.courierType as never } : {}),
    },
    include: { packTasks: true, store: { select: { name: true } } },
    take: 200,
  });
}

// ---------- RTO returns at warehouse ----------

export async function receiveRto(opts: {
  orderId: string;
  condition: RtoCondition;
  restockedQty?: number;
  writeOffQty?: number;
  photoUrl?: string;
  notes?: string;
  scannedByAdminId: string;
}) {
  const order = await prisma.order.findUnique({
    where: { id: opts.orderId },
    include: { items: true, store: true },
  });
  if (!order) throw new Error('Order not found');

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.rtoWarehouseReceipt.create({
      data: {
        orderId: order.id,
        condition: opts.condition,
        restockedQty: opts.restockedQty ?? 0,
        writeOffQty: opts.writeOffQty ?? 0,
        photoUrl: opts.photoUrl,
        notes: opts.notes,
      },
    });

    // Restock to the warehouse store inventory if condition is good.
    if (opts.condition === 'good' && opts.restockedQty && opts.restockedQty > 0) {
      const warehouseStore = await tx.store.findFirst({
        where: { tenantId: order.tenantId, name: { startsWith: 'EB Warehouse' } },
      });
      if (warehouseStore) {
        for (const item of order.items) {
          if (!item.variantId) continue;
          await tx.inventoryLevel.upsert({
            where: { variantId_storeId: { variantId: item.variantId, storeId: warehouseStore.id } },
            create: {
              tenantId: order.tenantId,
              variantId: item.variantId,
              storeId: warehouseStore.id,
              totalStock: opts.restockedQty,
              lastSyncedAt: new Date(),
            },
            update: {
              totalStock: { increment: opts.restockedQty },
              lastSyncedAt: new Date(),
            },
          });
          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              type: 'rto_restock',
              quantity: opts.restockedQty,
              orderId: order.id,
              reason: 'RTO restock at EB warehouse',
            },
          });
        }
      }
    }

    // Write-off path (damaged / unsellable).
    if (opts.writeOffQty && opts.writeOffQty > 0) {
      for (const item of order.items) {
        if (!item.variantId) continue;
        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            type: opts.condition === 'unsellable' ? 'write_off' : 'damage',
            quantity: -opts.writeOffQty,
            orderId: order.id,
            reason: `RTO ${opts.condition} write-off`,
          },
        });
      }
    }

    return receipt;
  }).then(async (receipt) => {
    // Promote the order to rto_returned + notify reseller.
    try {
      if (order.status !== 'rto_returned') {
        await changeOrderStatus({
          orderId: order.id,
          toStatus: 'rto_returned',
          actorType: 'admin',
          actorId: opts.scannedByAdminId,
          note: `RTO received at warehouse: ${opts.condition}`,
          force: true,
        });
      }
    } catch (err) {
      logger.warn({ err, orderId: order.id }, 'rto_status_promote_failed');
    }

    queueMicrotask(async () => {
      try {
        await dispatchNotification({
          tenantId: order.tenantId,
          eventType: 'rto.received_at_warehouse',
          title: `RTO received: ${opts.condition}`,
          body: `Order ${order.shopifyOrderNumber ?? order.id.slice(-8)} returned. Restocked: ${opts.restockedQty ?? 0}, write-off: ${opts.writeOffQty ?? 0}`,
          orderId: order.id,
        });
      } catch {
        /* swallow */
      }
    });

    return receipt;
  });
}

export async function listRtoReceipts(opts: { tenantId?: string; sinceDays?: number; limit?: number }) {
  const since = new Date(Date.now() - (opts.sinceDays ?? 30) * 24 * 60 * 60 * 1000);
  return prisma.rtoWarehouseReceipt.findMany({
    where: {
      receivedAt: { gte: since },
      ...(opts.tenantId ? { order: { tenantId: opts.tenantId } } : {}),
    },
    include: { order: { select: { id: true, customerName: true, city: true, tenant: { select: { name: true } } } } },
    orderBy: { receivedAt: 'desc' },
    take: opts.limit ?? 200,
  });
}
