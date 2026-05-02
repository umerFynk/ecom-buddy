import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { sendTemplateMessage } from '../wa/wa.service';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Record an OOS event when a variant runs out of stock or hits its low_stock_threshold
 * while servicing an order. Idempotent for an open event (one unresolved row per
 * (tenant, store, variant) at a time).
 *
 * Triggers reseller WA notification for the affected orders' customers and
 * counts the affected order against the event.
 */
export async function recordOosEvent(
  client: Tx,
  tenantId: string,
  storeId: string,
  variantId: string
): Promise<void> {
  // Find or create an open event.
  const open = await client.oosEvent.findFirst({
    where: { tenantId, storeId, variantId, resolvedAt: null },
  });

  if (open) {
    await client.oosEvent.update({
      where: { id: open.id },
      data: { affectedOrdersCount: { increment: 1 } },
    });
  } else {
    await client.oosEvent.create({
      data: {
        tenantId,
        storeId,
        variantId,
        affectedOrdersCount: 1,
      },
    });
  }
}

/**
 * Notify the customers of all open orders that have a particular OOS variant.
 * Called from the reseller "Notify affected customers" button.
 */
export async function notifyAffectedCustomers(eventId: string): Promise<{ notified: number }> {
  const event = await prisma.oosEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new Error('OOS event not found');

  // Find unfinished orders with this variant.
  const orders = await prisma.order.findMany({
    where: {
      tenantId: event.tenantId,
      items: { some: { variantId: event.variantId } },
      status: { in: ['new', 'pending_confirmation', 'confirmed', 'auto_confirmed', 'inventory_allocated', 'on_hold'] },
    },
    include: { items: { where: { variantId: event.variantId }, include: { variant: { include: { product: true } } } } },
  });

  let notified = 0;
  for (const order of orders) {
    const item = order.items[0];
    if (!item) continue;
    try {
      await sendTemplateMessage({
        tenantId: event.tenantId,
        phone: order.phone,
        template: 'order_oos_apology',
        orderId: order.id,
        variables: {
          customer_name: order.customerName,
          order_number: order.shopifyOrderNumber ?? order.id.slice(-8),
          product_title: item.variant?.product.title ?? item.title,
        },
      });
      notified++;
    } catch (err) {
      logger.warn({ err, orderId: order.id }, 'oos_notify_send_failed');
    }
  }

  await prisma.oosEvent.update({
    where: { id: event.id },
    data: { sellerNotifiedAt: new Date() },
  });

  return { notified };
}

/**
 * Daily admin digest — summarises today's open OOS events platform-wide.
 * Phase 5 will email this; Phase 2 just composes + logs the payload.
 */
export interface OosDigestRow {
  tenantId: string;
  tenantName: string;
  storeId: string;
  storeName: string;
  variantId: string;
  productTitle: string;
  sku: string;
  affectedOrders: number;
  triggeredAt: Date;
}

export async function buildAdminOosDigest(): Promise<OosDigestRow[]> {
  const events = await prisma.oosEvent.findMany({
    where: { resolvedAt: null },
    include: {
      tenant: { select: { id: true, name: true } },
      store: { select: { id: true, name: true } },
      variant: { include: { product: { select: { title: true } } } },
    },
    orderBy: { triggeredAt: 'desc' },
  });

  return events.map((e) => ({
    tenantId: e.tenantId,
    tenantName: e.tenant.name,
    storeId: e.storeId,
    storeName: e.store.name,
    variantId: e.variantId,
    productTitle: e.variant.product.title,
    sku: e.variant.sku,
    affectedOrders: e.affectedOrdersCount,
    triggeredAt: e.triggeredAt,
  }));
}
