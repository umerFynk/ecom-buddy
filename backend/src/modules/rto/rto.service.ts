import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { changeOrderStatus } from '../status/status.service';
import { sendTemplateMessage } from '../wa/wa.service';
import { manualEscalate } from '../blacklist/blacklist.service';

/**
 * RTO rescue flows. Five reason categories:
 *   wrong_address          → CS verifies address, optional retry
 *   customer_unavailable   → re-attempt + WA prompt
 *   refused                → cancellation + Level 2 escalation
 *   phone_unreachable      → try alt phone, otherwise CS hold
 *   fake_order             → auto-cancel + Level 3 blacklist
 *
 * Each rescue action increments order.rtoRescueAttempts and writes an
 * order_event row.
 */

export type RtoReason = 'wrong_address' | 'customer_unavailable' | 'refused' | 'phone_unreachable' | 'fake_order' | 'unknown';

const KEYWORD_MAP: Array<{ pattern: RegExp; reason: RtoReason }> = [
  { pattern: /(refused|denied|reject|did not accept|did not pay)/i,        reason: 'refused' },
  { pattern: /(wrong|incorrect|unable to find|address not found|invalid address)/i, reason: 'wrong_address' },
  { pattern: /(unavailable|absent|not at home|no one|out of station)/i,    reason: 'customer_unavailable' },
  { pattern: /(unreachable|no answer|number off|not responding|call not)/i, reason: 'phone_unreachable' },
  { pattern: /(fake|bogus|prank)/i,                                         reason: 'fake_order' },
];

/**
 * Classify an RTO event from courier remarks. Falls back to 'unknown'.
 */
export function classifyRtoReason(rawText: string | null | undefined): RtoReason {
  if (!rawText) return 'unknown';
  for (const { pattern, reason } of KEYWORD_MAP) {
    if (pattern.test(rawText)) return reason;
  }
  return 'unknown';
}

/**
 * Called from tracking poller / webhook when an order moves to rto_initiated
 * or rto_returned. Persists the inferred reason on the order so the dashboard
 * can rank "RTO Rescue" priorities.
 */
export async function tagRtoReason(orderId: string, rawText: string | null | undefined): Promise<{ reason: RtoReason }> {
  const reason = classifyRtoReason(rawText);
  await prisma.order.update({
    where: { id: orderId },
    data: { rtoReasonCategory: reason, rtoReasonText: rawText ?? null },
  });
  return { reason };
}

export interface RescueResult {
  orderId: string;
  reason: RtoReason;
  action: string;
  next?: string;
}

/**
 * Apply the per-reason rescue flow. Idempotent — callers can re-run; we
 * advance one step per call (capped by rtoRescueAttempts).
 */
export async function runRescueFlow(orderId: string, actorId?: string): Promise<RescueResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
  if (!order) throw new Error(`Order ${orderId} not found`);

  const reason = (order.rtoReasonCategory as RtoReason) ?? 'unknown';
  const attempts = order.rtoRescueAttempts;

  // Cap rescue attempts at 3 — beyond that, hold for CS.
  if (attempts >= 3) {
    return holdForCs(order.id, reason);
  }

  switch (reason) {
    case 'wrong_address':         return await flowWrongAddress(order.id, attempts);
    case 'customer_unavailable':  return await flowUnavailable(order.id, order.tenantId, order.phone, order.customerName, order.shopifyOrderNumber, attempts);
    case 'refused':               return await flowRefused(order.id, order.tenantId, order.customer?.id, attempts, actorId);
    case 'phone_unreachable':     return await flowPhoneUnreachable(order.id, order.alternatePhone, attempts);
    case 'fake_order':            return await flowFakeOrder(order.id, order.tenantId, order.customer?.id, attempts, actorId);
    default:                      return await holdForCs(order.id, reason);
  }
}

async function bumpAttempts(orderId: string) {
  await prisma.order.update({ where: { id: orderId }, data: { rtoRescueAttempts: { increment: 1 } } });
}

async function logEvent(orderId: string, note: string, metadata?: Record<string, unknown>) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  await prisma.orderEvent.create({
    data: {
      orderId,
      fromStatus: order?.status ?? null,
      toStatus: order?.status ?? 'unknown',
      actorType: 'system',
      note,
      ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
    },
  });
}

async function flowWrongAddress(orderId: string, attempts: number): Promise<RescueResult> {
  await bumpAttempts(orderId);
  await logEvent(orderId, `RTO rescue (wrong_address) attempt ${attempts + 1}: held for CS to confirm address with customer`);
  await changeOrderStatus({
    orderId,
    toStatus: 'on_hold',
    actorType: 'system',
    note: 'RTO rescue: address verification needed',
    force: true,
  });
  return { orderId, reason: 'wrong_address', action: 'held_for_cs_address_verify', next: 'CS contacts customer to confirm address, then resubmit booking' };
}

async function flowUnavailable(
  orderId: string,
  tenantId: string,
  phone: string,
  customerName: string,
  shopifyOrderNumber: string | null,
  attempts: number
): Promise<RescueResult> {
  await bumpAttempts(orderId);
  try {
    await sendTemplateMessage({
      tenantId,
      phone,
      template: 'order_confirmation_request', // re-use the reaffirmation template
      orderId,
      variables: {
        customer_name: customerName,
        order_number: shopifyOrderNumber ?? orderId.slice(-8),
        amount: '',
        city: '',
      },
    });
  } catch (err) {
    logger.warn({ err, orderId }, 'rto_unavailable_wa_failed');
  }
  await logEvent(orderId, `RTO rescue (customer_unavailable) attempt ${attempts + 1}: WA reattempt sent`);
  return { orderId, reason: 'customer_unavailable', action: 'wa_reattempt_sent', next: 'Wait 24h for response then re-book or auto-cancel' };
}

async function flowRefused(
  orderId: string,
  tenantId: string,
  customerId: string | undefined,
  attempts: number,
  actorId?: string
): Promise<RescueResult> {
  await bumpAttempts(orderId);
  await changeOrderStatus({
    orderId,
    toStatus: 'cancelled_by_customer',
    actorType: 'system',
    note: 'RTO rescue: customer refused on delivery',
    force: true,
  });
  if (customerId) {
    await manualEscalate({
      tenantId,
      customerId,
      level: 'high_risk',
      reason: 'RTO refused on delivery (auto-escalated)',
      actorId: actorId ?? 'system',
      actorType: 'reseller_user',
    }).catch(() => {});
  }
  return { orderId, reason: 'refused', action: 'cancelled_and_escalated', next: 'Customer pushed to Level 2 (high_risk)' };
}

async function flowPhoneUnreachable(orderId: string, altPhone: string | null, attempts: number): Promise<RescueResult> {
  await bumpAttempts(orderId);
  if (altPhone) {
    await logEvent(orderId, `RTO rescue (phone_unreachable) attempt ${attempts + 1}: trying alt phone ${altPhone.slice(0, 5)}*****`);
    return { orderId, reason: 'phone_unreachable', action: 'try_alt_phone', next: `Re-book with alt phone ${altPhone}` };
  }
  await changeOrderStatus({
    orderId,
    toStatus: 'on_hold',
    actorType: 'system',
    note: 'RTO rescue: no alt phone — held for CS',
    force: true,
  });
  return { orderId, reason: 'phone_unreachable', action: 'held_for_cs_no_alt_phone' };
}

async function flowFakeOrder(
  orderId: string,
  tenantId: string,
  customerId: string | undefined,
  attempts: number,
  actorId?: string
): Promise<RescueResult> {
  await bumpAttempts(orderId);
  await changeOrderStatus({
    orderId,
    toStatus: 'cancelled_fake',
    actorType: 'system',
    note: 'RTO rescue: classified as fake order',
    force: true,
  });
  if (customerId) {
    await manualEscalate({
      tenantId,
      customerId,
      level: 'blacklisted',
      reason: 'Fake order RTO (auto-escalated to Level 3)',
      actorId: actorId ?? 'system',
      actorType: 'reseller_user',
    }).catch(() => {});
  }
  return { orderId, reason: 'fake_order', action: 'cancelled_and_blacklisted', next: 'Customer pushed to Level 3 (blacklisted)' };
}

async function holdForCs(orderId: string, reason: RtoReason): Promise<RescueResult> {
  await bumpAttempts(orderId);
  await changeOrderStatus({
    orderId,
    toStatus: 'on_hold',
    actorType: 'system',
    note: `RTO rescue: max attempts reached or unknown reason — held for CS (${reason})`,
    force: true,
  });
  return { orderId, reason, action: 'held_for_cs', next: 'CS to manually triage' };
}
