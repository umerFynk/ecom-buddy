import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { changeOrderStatus } from '../status/status.service';

/**
 * Pick + pack workflow for 3PL orders (BLUEPRINT.md Part 25).
 *
 * On order confirmed for a store with dispatch_mode = ecombuddy_3pl:
 *   - createPickTaskForOrder() resolves a default warehouse + best-effort
 *     bin location per item (via sku_locations), creates a pick_task with
 *     pick_task_items, and the order becomes 'inventory_allocated'.
 *
 * Mobile pick flow:
 *   POST /v1/wms/pick/scan { taskId, locationBarcode, variantId, qty }
 *   When all items qty_picked == qty_required → task complete → spawns a
 *   pack_task.
 *
 * Pack flow:
 *   PATCH /v1/wms/pack/:taskId { weightKg, photoUrl } → mark packed →
 *   ready for courier handover (Phase 8 outbound flow).
 */

export async function createPickTaskForOrder(opts: { orderId: string; warehouseId?: string; assignedToId?: string }) {
  const order = await prisma.order.findUnique({
    where: { id: opts.orderId },
    include: { items: true, store: true },
  });
  if (!order) throw new Error('Order not found');
  if (order.store.dispatchMode !== 'ecombuddy_3pl') {
    return null; // not a 3PL order
  }

  // Pick the first warehouse if not specified.
  let warehouseId = opts.warehouseId;
  if (!warehouseId) {
    const wh = await prisma.warehouse.findFirst({ where: { isActive: true } });
    if (!wh) throw new Error('No active warehouse');
    warehouseId = wh.id;
  }

  return prisma.$transaction(async (tx) => {
    const task = await tx.pickTask.create({
      data: {
        orderId: order.id,
        warehouseId: warehouseId!,
        assignedToId: opts.assignedToId,
        status: 'pending',
      },
    });

    for (const item of order.items) {
      if (!item.variantId) continue;
      const sl = await tx.skuLocation.findFirst({
        where: { variantId: item.variantId, location: { zone: { warehouseId } } },
        orderBy: { quantity: 'desc' },
      });
      await tx.pickTaskItem.create({
        data: {
          taskId: task.id,
          variantId: item.variantId,
          locationId: sl?.locationId ?? null,
          qtyRequired: item.quantity,
        },
      });
    }
    return task;
  });
}

/**
 * Mobile pick scan. Validates the location barcode matches the planned bin
 * (or any bin holding the variant), increments qty_picked, decrements the
 * sku_location stock. Returns whether the parent task is now complete.
 */
export async function scanPick(opts: {
  taskId: string;
  locationBarcode: string;
  variantId: string;
  qty: number;
  scannedByAdminId: string;
}) {
  const task = await prisma.pickTask.findUnique({
    where: { id: opts.taskId },
    include: { items: true },
  });
  if (!task) throw new Error('Task not found');
  if (task.status === 'completed' || task.status === 'cancelled') throw new Error('Task already closed');

  const item = task.items.find((i) => i.variantId === opts.variantId && i.qtyPicked < i.qtyRequired);
  if (!item) throw new Error('No matching pick item or already filled');

  const location = await prisma.warehouseLocation.findUnique({ where: { barcode: opts.locationBarcode } });
  if (!location) throw new Error('Location barcode not recognized');

  const sl = await prisma.skuLocation.findUnique({
    where: { variantId_locationId: { variantId: opts.variantId, locationId: location.id } },
  });
  if (!sl || sl.quantity < opts.qty) {
    throw new Error(`Insufficient stock at location (have ${sl?.quantity ?? 0}, asked for ${opts.qty})`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.pickTaskItem.update({
      where: { id: item.id },
      data: { qtyPicked: { increment: opts.qty }, locationId: location.id, scannedAt: new Date() },
    });
    await tx.skuLocation.update({
      where: { id: sl.id },
      data: { quantity: { decrement: opts.qty } },
    });
    await tx.pickTask.update({
      where: { id: task.id },
      data: {
        status: 'in_progress',
        startedAt: task.startedAt ?? new Date(),
        assignedToId: task.assignedToId ?? opts.scannedByAdminId,
      },
    });
  });

  // Re-check completion.
  const fresh = await prisma.pickTask.findUnique({ where: { id: task.id }, include: { items: true } });
  const complete = fresh?.items.every((i) => i.qtyPicked >= i.qtyRequired) ?? false;
  if (complete) {
    await prisma.pickTask.update({
      where: { id: task.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    // Spawn pack task.
    await prisma.packTask.create({
      data: { orderId: task.orderId, status: 'pending' },
    });
  }
  return { complete, task: fresh };
}

export async function listPickTasks(opts: { assignedToAdminId?: string; warehouseId?: string; status?: string }) {
  return prisma.pickTask.findMany({
    where: {
      ...(opts.assignedToAdminId ? { assignedToId: opts.assignedToAdminId } : {}),
      ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
      ...(opts.status ? { status: opts.status as never } : {}),
    },
    include: {
      order: { select: { id: true, customerName: true, city: true, amount: true, shopifyOrderNumber: true } },
      items: { include: { variant: { include: { product: true } }, location: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
}

// ---------- Pack ----------

export async function listPackTasks(opts: { assignedToAdminId?: string; status?: string }) {
  return prisma.packTask.findMany({
    where: {
      ...(opts.assignedToAdminId ? { assignedToId: opts.assignedToAdminId } : {}),
      ...(opts.status ? { status: opts.status as never } : {}),
    },
    include: {
      order: { select: { id: true, customerName: true, city: true, amount: true, shopifyOrderNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
}

export async function completePack(opts: { taskId: string; weightKg: number; photoUrl?: string; assignedToAdminId: string }) {
  const task = await prisma.packTask.findUnique({ where: { id: opts.taskId } });
  if (!task) throw new Error('Pack task not found');

  const updated = await prisma.packTask.update({
    where: { id: task.id },
    data: {
      status: 'packed',
      assignedToId: task.assignedToId ?? opts.assignedToAdminId,
      weightKg: new Prisma.Decimal(opts.weightKg),
      photoUrl: opts.photoUrl,
      startedAt: task.startedAt ?? new Date(),
      completedAt: new Date(),
    },
  });

  // Move the order to inventory_allocated → keeps it in the queue for the
  // outbound batch which will book the courier and call mark-dispatched.
  try {
    const order = await prisma.order.findUnique({ where: { id: task.orderId } });
    if (order && order.status === 'confirmed') {
      await changeOrderStatus({
        orderId: order.id,
        toStatus: 'inventory_allocated',
        actorType: 'admin',
        actorId: opts.assignedToAdminId,
        note: 'Packed at EB warehouse',
        force: true,
      });
    }
  } catch (err) {
    logger.warn({ err, orderId: task.orderId }, 'pack_status_promote_failed');
  }

  return updated;
}
