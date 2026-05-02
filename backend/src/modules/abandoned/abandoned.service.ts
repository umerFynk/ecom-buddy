import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { normalizePakistaniPhone } from '@/lib/phoneNormalize';
import { getQueue } from '@/jobs/queue';
import type { WaSendJob } from '@/jobs/workers/wa.worker';
import { QUEUES } from '@/jobs/queue';

export const ABANDONED_REMINDER_QUEUE = QUEUES.WA_SEND;
export const ABANDONED_DEFAULT_DELAY_MIN = 30;

export interface ShopifyCheckoutPayload {
  id: number;
  token?: string;
  email?: string;
  phone?: string;
  total_price?: string;
  currency?: string;
  customer?: { phone?: string; email?: string; first_name?: string; last_name?: string };
  shipping_address?: { phone?: string; name?: string; first_name?: string; last_name?: string };
  line_items?: Array<{ title?: string; quantity?: number; price?: string }>;
  abandoned_checkout_url?: string;
}

/**
 * Persist (or refresh) an abandoned cart row from a Shopify checkouts webhook.
 * Schedules a delayed WA reminder which checks at fire time whether the
 * checkout converted to an order.
 */
export async function ingestAbandonedCheckout(storeId: string, payload: ShopifyCheckoutPayload): Promise<{ id: string; scheduled: boolean }> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new Error('store not found');

  const phoneRaw = payload.phone ?? payload.shipping_address?.phone ?? payload.customer?.phone;
  const phoneRes = normalizePakistaniPhone(phoneRaw ?? '');

  const customerName =
    payload.shipping_address?.name ||
    [payload.shipping_address?.first_name, payload.shipping_address?.last_name].filter(Boolean).join(' ') ||
    [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(' ') ||
    null;

  const itemsSummary = (payload.line_items ?? []).slice(0, 10).map((li) => ({
    title: li.title ?? '',
    quantity: li.quantity ?? 1,
    price: li.price ?? '0',
  }));

  const cart = await prisma.abandonedCart.upsert({
    where: {
      tenantId_shopifyCheckoutToken: {
        tenantId: store.tenantId,
        shopifyCheckoutToken: payload.token ?? String(payload.id),
      },
    },
    create: {
      tenantId: store.tenantId,
      storeId: store.id,
      shopifyCheckoutId: String(payload.id),
      shopifyCheckoutToken: payload.token ?? String(payload.id),
      customerName,
      phoneNormalized: phoneRes.valid ? phoneRes.normalized : null,
      email: payload.email ?? payload.customer?.email ?? null,
      totalAmount: payload.total_price ? new Prisma.Decimal(payload.total_price) : null,
      currency: payload.currency ?? 'PKR',
      itemsSummary: itemsSummary as unknown as Prisma.InputJsonValue,
      status: 'pending',
    },
    update: {
      customerName: customerName ?? undefined,
      phoneNormalized: phoneRes.valid ? phoneRes.normalized : undefined,
      email: payload.email ?? payload.customer?.email ?? undefined,
      totalAmount: payload.total_price ? new Prisma.Decimal(payload.total_price) : undefined,
      itemsSummary: itemsSummary as unknown as Prisma.InputJsonValue,
    },
  });

  // Only schedule the reminder if (a) the cart is still pending and (b) we
  // have a valid Pakistani phone to message.
  if (cart.status !== 'pending' || !cart.phoneNormalized) return { id: cart.id, scheduled: false };

  const queue = getQueue<WaSendJob>(ABANDONED_REMINDER_QUEUE);
  await queue.add(
    'abandoned-cart',
    {
      tenantId: cart.tenantId,
      storeId: cart.storeId,
      phone: cart.phoneNormalized,
      respectBusinessHours: true,
      eventType: 'abandoned_cart',
      payload: {
        kind: 'text',
        text: buildReminderText(cart.customerName ?? 'Friend', Number(cart.totalAmount ?? 0), payload.abandoned_checkout_url),
      },
    },
    {
      jobId: `abandoned-${cart.id}`,
      delay: ABANDONED_DEFAULT_DELAY_MIN * 60 * 1000,
      attempts: 2,
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  return { id: cart.id, scheduled: true };
}

/**
 * Mark an abandoned cart as recovered when an order is created with the
 * matching checkout token. Wired from the Shopify orders/create webhook.
 */
export async function markRecoveredFromOrder(opts: { tenantId: string; checkoutToken?: string | null; orderId: string }): Promise<void> {
  if (!opts.checkoutToken) return;
  const cart = await prisma.abandonedCart.findFirst({
    where: { tenantId: opts.tenantId, shopifyCheckoutToken: opts.checkoutToken, status: 'pending' },
  });
  if (!cart) return;
  await prisma.abandonedCart.update({
    where: { id: cart.id },
    data: { status: 'recovered', recoveredOrderId: opts.orderId, resolvedAt: new Date() },
  });
}

/**
 * Called from the WA worker right before sending the reminder message — if
 * the cart is no longer pending we tell the worker to skip.
 */
export async function shouldSendReminder(cartId: string): Promise<boolean> {
  const cart = await prisma.abandonedCart.findUnique({ where: { id: cartId } });
  if (!cart) return false;
  return cart.status === 'pending';
}

function buildReminderText(name: string, amount: number, checkoutUrl?: string | null): string {
  const amountStr = amount > 0 ? ` for Rs ${amount.toFixed(0)}` : '';
  const link = checkoutUrl ? `\n\nComplete your order: ${checkoutUrl}` : '';
  return `Hi ${name}, you left items in your cart${amountStr}. Reply "YES" to place the order or click the link to complete checkout.${link}`;
}

export async function listAbandonedCarts(tenantId: string, limit = 100) {
  return prisma.abandonedCart.findMany({
    where: { tenantId },
    orderBy: { abandonedAt: 'desc' },
    take: limit,
  });
}
