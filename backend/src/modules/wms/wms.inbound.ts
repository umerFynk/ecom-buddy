import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { dispatchNotification } from '../notifications/notifications.service';

/**
 * Inbound receiving (BLUEPRINT.md Part 25 — Inbound). Reseller declares a
 * shipment of stock arriving at the EB warehouse. We issue a GRN number,
 * the warehouse staff scan items on arrival, mark per-item received_qty,
 * flag discrepancies with photo, and complete the GRN. Completion bumps
 * the InventoryLevel rows (warehouse_store) and notifies the reseller.
 */

function grn(prefix = 'EB'): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

export interface CreateInboundInput {
  tenantId: string;
  warehouseId: string;
  expectedAt?: Date;
  items: Array<{ variantId: string; expectedQty: number }>;
}

export async function createInbound(input: CreateInboundInput) {
  return prisma.$transaction(async (tx) => {
    const totalExpected = input.items.reduce((acc, i) => acc + i.expectedQty, 0);
    const grnNumber = grn();
    const inbound = await tx.inboundShipment.create({
      data: {
        tenantId: input.tenantId,
        warehouseId: input.warehouseId,
        grnNumber,
        status: 'pending',
        expectedAt: input.expectedAt,
        totalExpected,
        items: { create: input.items },
      },
      include: { items: true },
    });
    return inbound;
  });
}

export async function startReceiving(inboundId: string) {
  return prisma.inboundShipment.update({
    where: { id: inboundId },
    data: { status: 'receiving' },
  });
}

export async function recordItemReceived(opts: {
  inboundId: string;
  itemId: string;
  receivedQty: number;
  condition?: string;
  photoUrl?: string;
}) {
  const item = await prisma.inboundItem.findUnique({ where: { id: opts.itemId } });
  if (!item || item.inboundId !== opts.inboundId) throw new Error('Inbound item mismatch');
  return prisma.inboundItem.update({
    where: { id: item.id },
    data: { receivedQty: opts.receivedQty, condition: opts.condition, photoUrl: opts.photoUrl },
  });
}

/**
 * Complete the GRN: sums received quantities, marks discrepancy if any
 * received_qty < expected_qty, bumps inventory_levels for the warehouse
 * "store" (each tenant has a virtual EB-warehouse store row created
 * lazily here), and notifies the reseller.
 */
export async function completeInbound(inboundId: string) {
  return prisma.$transaction(async (tx) => {
    const inbound = await tx.inboundShipment.findUnique({
      where: { id: inboundId },
      include: { items: true },
    });
    if (!inbound) throw new Error('Inbound not found');

    const totalReceived = inbound.items.reduce((acc, i) => acc + i.receivedQty, 0);
    const hasDiscrepancy = inbound.items.some((i) => i.receivedQty < i.expectedQty);

    // Find or create the virtual warehouse store for this tenant.
    let warehouseStore = await tx.store.findFirst({
      where: { tenantId: inbound.tenantId, name: { startsWith: 'EB Warehouse' } },
    });
    if (!warehouseStore) {
      warehouseStore = await tx.store.create({
        data: {
          tenantId: inbound.tenantId,
          name: `EB Warehouse — ${inbound.warehouseId.slice(-6)}`,
          dispatchMode: 'ecombuddy_3pl',
          confirmationMode: 'manual',
          wmsEnabled: true,
        },
      });
    }

    for (const it of inbound.items) {
      if (it.receivedQty <= 0) continue;
      await tx.inventoryLevel.upsert({
        where: { variantId_storeId: { variantId: it.variantId, storeId: warehouseStore.id } },
        create: {
          tenantId: inbound.tenantId,
          variantId: it.variantId,
          storeId: warehouseStore.id,
          totalStock: it.receivedQty,
          lastSyncedAt: new Date(),
        },
        update: {
          totalStock: { increment: it.receivedQty },
          lastSyncedAt: new Date(),
        },
      });
      await tx.inventoryMovement.create({
        data: {
          variantId: it.variantId,
          type: 'inbound',
          quantity: it.receivedQty,
          reason: `GRN ${inbound.grnNumber}`,
        },
      });
    }

    const updated = await tx.inboundShipment.update({
      where: { id: inbound.id },
      data: {
        status: hasDiscrepancy ? 'discrepancy' : 'received',
        receivedAt: new Date(),
        totalReceived,
      },
    });

    queueMicrotask(async () => {
      try {
        await dispatchNotification({
          tenantId: inbound.tenantId,
          eventType: 'inbound.received',
          title: hasDiscrepancy
            ? `GRN ${inbound.grnNumber} received with discrepancies`
            : `GRN ${inbound.grnNumber} fully received`,
          body: `Expected ${inbound.totalExpected}, received ${totalReceived}`,
        });
      } catch {
        /* swallow */
      }
    });

    return updated;
  });
}

export async function listInbound(tenantId: string, opts?: { status?: string }) {
  return prisma.inboundShipment.findMany({
    where: { tenantId, ...(opts?.status ? { status: opts.status as never } : {}) },
    include: { items: true, warehouse: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
