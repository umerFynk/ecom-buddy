import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { getQueue, QUEUES } from '@/jobs/queue';
import type { WaSendJob } from '@/jobs/workers/wa.worker';
import { TemplateKey } from '../wa/wa.templates';

/**
 * Auto-message dispatcher. Runs after every successful status change.
 * Each event type → template + variable builder. Per-tenant on/off lives in
 * auto_message_settings; default is on for all.
 *
 * Messages are queued through the wa-send queue, which respects the
 * business-hours gate.
 */

interface EventContext {
  orderId: string;
  fromStatus: string | null;
  toStatus: string;
  tenantId: string;
  storeId: string;
}

const EVENT_BY_STATUS: Record<string, string> = {
  confirmed: 'order.confirmed',
  auto_confirmed: 'order.confirmed',
  dispatched: 'order.dispatched',
  delivered: 'order.delivered',
  rto_initiated: 'order.rto_initiated',
  cancelled_by_seller: 'order.cancelled',
  cancelled_no_response: 'order.cancelled',
  cancelled_fake: 'order.cancelled',
  cancelled_by_customer: 'order.cancelled',
  cancelled_by_courier: 'order.cancelled',
};

const EVENT_TEMPLATE: Record<string, TemplateKey> = {
  'order.confirmed':     'order_confirmed',
  'order.dispatched':    'order_dispatched',
  'order.delivered':     'order_delivered',
  'order.rto_initiated': 'order_cancelled_no_response', // closest fit; reseller can override
  'order.cancelled':     'order_cancelled_no_response',
};

async function isEventEnabled(tenantId: string, eventType: string): Promise<boolean> {
  const setting = await prisma.autoMessageSetting.findUnique({
    where: { tenantId_eventType: { tenantId, eventType } },
  });
  if (!setting) return true; // default on
  return setting.isEnabled;
}

/**
 * Public entry. Called from status.service.ts after a successful status change.
 * Errors are swallowed (best-effort) so messaging failures never block order
 * progression.
 */
export async function dispatchAutoMessages(ctx: EventContext): Promise<void> {
  const eventType = EVENT_BY_STATUS[ctx.toStatus];
  if (!eventType) return;

  try {
    if (!(await isEventEnabled(ctx.tenantId, eventType))) return;

    const order = await prisma.order.findUnique({
      where: { id: ctx.orderId },
      include: { shipments: true, store: true },
    });
    if (!order) return;

    const template = EVENT_TEMPLATE[eventType];
    if (!template) return;

    const variables = buildVariables(eventType, order);
    const queue = getQueue<WaSendJob>(QUEUES.WA_SEND);
    await queue.add(
      eventType,
      {
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        phone: order.phone,
        orderId: order.id,
        eventType,
        respectBusinessHours: true,
        payload: { kind: 'template', template, variables },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 200, removeOnFail: 100 }
    );
  } catch (err) {
    logger.warn({ err, ctx }, 'auto_message_dispatch_failed');
  }
}

function buildVariables(
  eventType: string,
  order: {
    customerName: string;
    shopifyOrderNumber: string | null;
    id: string;
    amount: { toString(): string };
    city: string;
    courierType: string | null;
    trackingNumber: string | null;
    shipments: Array<{ trackingNumber: string }>;
  }
): Record<string, string> {
  const orderNum = order.shopifyOrderNumber ?? order.id.slice(-8);
  const shipment = order.shipments[0];
  const trackingUrl = `https://track.ecombuddy.pk/${order.id}`;
  switch (eventType) {
    case 'order.confirmed':
      return {
        customer_name: order.customerName,
        order_number: orderNum,
        tracking_url: trackingUrl,
      };
    case 'order.dispatched':
      return {
        order_number: orderNum,
        courier: order.courierType ?? 'Courier',
        tracking_number: order.trackingNumber ?? shipment?.trackingNumber ?? '—',
        cod_amount: order.amount.toString(),
        tracking_url: trackingUrl,
      };
    case 'order.delivered':
      return { order_number: orderNum };
    case 'order.rto_initiated':
    case 'order.cancelled':
      return { customer_name: order.customerName, order_number: orderNum };
    default:
      return { order_number: orderNum };
  }
}
