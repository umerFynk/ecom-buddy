import { Order, ConfirmationMode, Customer } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { changeOrderStatus } from '../status/status.service';
import { scoreOrder } from '../risk/risk.service';
import { sendTemplateMessage } from '../wa/wa.service';
import { generateOtp } from '../wa/wa.templates';
import { normalizeCity } from '@/lib/cityNormalize';
import { normalizePakistaniPhone } from '@/lib/phoneNormalize';
import { ConfirmationPath } from './confirmation.types';
import { parseReply } from './confirmation.replies';
import { getQueue, QUEUES } from '@/jobs/queue';
import { allocateForOrder } from '../inventory/inventory.alloc';

/**
 * The confirmation engine sits between order ingestion and dispatch. It is
 * called once per order on creation. It picks ONE of paths A-E (Manual mode)
 * or delegates to ai_engine (Mode 3), persists a confirmation_logs row, and
 * either auto-confirms / sends a WA / schedules a timeout.
 *
 * Inbound WA replies route back through handleInboundCustomerReply which
 * locates the open ConfirmationLog by phone and resolves it.
 */

export interface ConfirmationDecision {
  path: ConfirmationPath;
  outcome: 'auto_confirmed' | 'wa_sent' | 'otp_sent' | 'cs_review' | 'auto_cancelled';
  reason: string;
}

export async function runConfirmationFor(orderId: string): Promise<ConfirmationDecision> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true, store: true, tenant: true },
  });
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.status !== 'new' && order.status !== 'pending_confirmation') {
    return { path: 'A', outcome: 'auto_confirmed', reason: `order already in ${order.status}` };
  }

  const config = order.store.confirmationMode;

  // Mode OFF — straight to confirmed, then auto-allocate.
  if (config === ConfirmationMode.off) {
    return autoConfirm(order, 'A', 'store_confirmation_off');
  }

  // Score the order — also persists riskScore/riskBreakdown.
  const cityRes = await normalizeCity(order.city);
  const phoneRes = normalizePakistaniPhone(order.phone);
  const scored = await scoreOrder(
    order.tenantId,
    {
      amount: Number(order.amount),
      paymentStatus: order.paymentStatus,
      city: cityRes.canonical || order.city,
      cityTier: (cityRes.tier as 1 | 2 | 3 | 4) ?? 1,
      phone: order.phone,
      phoneIsValid: phoneRes.valid,
      addressLine1: order.addressLine1,
      addressLine2: order.addressLine2,
      createdAt: order.createdAt,
      customerTags: order.customer?.tags ?? [],
      isVip: order.customer?.isVip ?? false,
    },
    {
      exists: Boolean(order.customer),
      totalOrders: order.customer?.totalOrders ?? 0,
      deliveredCount: order.customer?.deliveredCount ?? 0,
      returnedCount: order.customer?.returnedCount ?? 0,
      blacklistLevel: (order.customer?.blacklistLevel ?? 'clean') as never,
    }
  );

  await prisma.order.update({
    where: { id: order.id },
    data: { riskScore: scored.breakdown.finalScore, riskFlags: scored.flags, riskBreakdown: scored.breakdown as never },
  });

  // Path A bypass conditions (any of):
  if (
    order.paymentStatus === 'prepaid' ||
    order.customer?.isVip ||
    isRepeatTrustedCustomer(order.customer)
  ) {
    return autoConfirm(order, 'A', 'bypass_condition_met');
  }

  // Risk decision routing:
  const decision = scored.breakdown.decision;

  if (decision === 'auto_confirm') {
    return autoConfirm(order, scored.breakdown.modeUsed === 'ai_engine' ? 'ai_engine' : 'A', 'risk_auto_confirm');
  }

  if (decision === 'auto_cancel') {
    return autoCancel(order, scored.breakdown.modeUsed === 'ai_engine' ? 'ai_engine' : 'E', 'risk_auto_cancel');
  }

  if (decision === 'cs_review') {
    return holdForCs(order, scored.breakdown.modeUsed === 'ai_engine' ? 'ai_engine' : 'D', 'risk_cs_review');
  }

  if (decision === 'otp_required') {
    return sendOtp(order, 'C', 'risk_otp_required');
  }

  // Default: Path B — standard WA confirmation
  return sendWaConfirmation(order, 'B', 'risk_wa_confirm');
}

function isRepeatTrustedCustomer(customer: Customer | null | undefined): boolean {
  if (!customer) return false;
  // ≥3 prior orders AND ≥80% delivery success
  if (customer.totalOrders < 3) return false;
  const completed = customer.deliveredCount + customer.returnedCount;
  if (completed < 3) return false;
  const rate = (customer.deliveredCount / completed) * 100;
  return rate >= 80;
}

async function autoConfirm(order: Order, path: ConfirmationPath, reason: string): Promise<ConfirmationDecision> {
  await prisma.confirmationLog.create({
    data: {
      orderId: order.id,
      pathUsed: path,
      modeUsed: ConfirmationMode.manual,
      outcome: 'confirmed',
      sentAt: new Date(),
      repliedAt: new Date(),
    },
  });

  await changeOrderStatus({
    orderId: order.id,
    toStatus: 'auto_confirmed',
    actorType: 'system',
    note: `Auto-confirmed: ${reason}`,
  });

  // Allocate inventory in the background — best-effort.
  void allocateForOrder(order.id).catch((err) => logger.warn({ err, orderId: order.id }, 'allocate_failed'));
  // For 3PL stores, also queue a pick task.
  void maybeCreatePickTask(order.id).catch(() => {});
  return { path, outcome: 'auto_confirmed', reason };
}

async function maybeCreatePickTask(orderId: string): Promise<void> {
  try {
    const { createPickTaskForOrder } = await import('../wms/wms.pickPack');
    await createPickTaskForOrder({ orderId });
  } catch {
    /* swallow — non-3PL stores throw or return null */
  }
}

async function autoCancel(order: Order, path: ConfirmationPath, reason: string): Promise<ConfirmationDecision> {
  await prisma.confirmationLog.create({
    data: { orderId: order.id, pathUsed: path, modeUsed: ConfirmationMode.manual, outcome: 'cancelled', sentAt: new Date() },
  });
  await changeOrderStatus({
    orderId: order.id,
    toStatus: 'cancelled_fake',
    actorType: 'system',
    note: `Auto-cancelled: ${reason}`,
  });
  return { path, outcome: 'auto_cancelled', reason };
}

async function holdForCs(order: Order, path: ConfirmationPath, reason: string): Promise<ConfirmationDecision> {
  await prisma.confirmationLog.create({
    data: { orderId: order.id, pathUsed: path, modeUsed: ConfirmationMode.manual, outcome: 'hold', sentAt: new Date() },
  });
  await changeOrderStatus({
    orderId: order.id,
    toStatus: 'on_hold',
    actorType: 'system',
    note: `Held for CS review: ${reason}`,
  });
  return { path, outcome: 'cs_review', reason };
}

async function sendWaConfirmation(order: Order & { tenant: { name: string } }, path: ConfirmationPath, reason: string): Promise<ConfirmationDecision> {
  const log = await prisma.confirmationLog.create({
    data: { orderId: order.id, pathUsed: path, modeUsed: ConfirmationMode.manual, sentAt: new Date(), attempts: 1 },
  });

  await changeOrderStatus({
    orderId: order.id,
    toStatus: 'pending_confirmation',
    actorType: 'system',
    note: `WA confirmation sent (path ${path})`,
  });

  try {
    const res = await sendTemplateMessage({
      tenantId: order.tenantId,
      phone: order.phone,
      template: 'order_confirmation_request',
      orderId: order.id,
      variables: {
        customer_name: order.customerName,
        order_number: order.shopifyOrderNumber ?? order.id.slice(-8),
        amount: order.amount.toString(),
        city: order.city,
      },
    });
    await prisma.confirmationLog.update({
      where: { id: log.id },
      data: { waMessageId: res.waMessageId },
    });
  } catch (err) {
    logger.warn({ err, orderId: order.id }, 'wa_confirm_send_failed');
  }

  await scheduleNoResponseTimeout(order.id, order.tenantId);
  return { path, outcome: 'wa_sent', reason };
}

async function sendOtp(order: Order, path: ConfirmationPath, reason: string): Promise<ConfirmationDecision> {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const log = await prisma.confirmationLog.create({
    data: {
      orderId: order.id,
      pathUsed: path,
      modeUsed: ConfirmationMode.manual,
      sentAt: new Date(),
      otpCode: otp,
      otpExpiresAt: expiresAt,
      attempts: 1,
    },
  });

  await changeOrderStatus({
    orderId: order.id,
    toStatus: 'pending_confirmation',
    actorType: 'system',
    note: `OTP sent (path C)`,
  });

  try {
    const res = await sendTemplateMessage({
      tenantId: order.tenantId,
      phone: order.phone,
      template: 'order_otp_request',
      orderId: order.id,
      variables: {
        order_number: order.shopifyOrderNumber ?? order.id.slice(-8),
        otp,
      },
    });
    await prisma.confirmationLog.update({ where: { id: log.id }, data: { waMessageId: res.waMessageId } });
  } catch (err) {
    logger.warn({ err, orderId: order.id }, 'wa_otp_send_failed');
  }

  await scheduleNoResponseTimeout(order.id, order.tenantId);
  return { path, outcome: 'otp_sent', reason };
}

async function scheduleNoResponseTimeout(orderId: string, tenantId: string) {
  const cfg = await prisma.riskEngineConfig.findUnique({ where: { tenantId } });
  const hours = cfg?.noResponseHours ?? 24;
  const delay = hours * 60 * 60 * 1000;
  const queue = getQueue(QUEUES.CONFIRMATION_TIMEOUT);
  await queue.add('no-response', { orderId, tenantId }, { delay, removeOnComplete: 100, removeOnFail: 100 });
}

/**
 * Inbound reply router. Looks up the most recent open ConfirmationLog for this
 * phone (via order.phone) and resolves it. Called from the WA inbound webhook.
 */
export async function handleInboundCustomerReply(tenantId: string, phone: string, text: string) {
  // Find newest open confirmation log for this tenant + phone.
  const order = await prisma.order.findFirst({
    where: { tenantId, phone, status: 'pending_confirmation' },
    orderBy: { createdAt: 'desc' },
    include: { confirmationLogs: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!order) return null;
  const log = order.confirmationLogs[0];
  if (!log || log.outcome) return null;

  const parsed = parseReply(text);

  if (parsed.intent === 'cancel') {
    await prisma.confirmationLog.update({
      where: { id: log.id },
      data: { repliedAt: new Date(), replyText: text, outcome: 'refused' },
    });
    await changeOrderStatus({
      orderId: order.id,
      toStatus: 'cancelled_by_customer',
      actorType: 'system',
      note: 'Customer refused confirmation',
    });
    return { resolved: 'cancelled' as const };
  }

  if (parsed.intent === 'otp' && log.otpCode) {
    if (log.otpExpiresAt && log.otpExpiresAt < new Date()) {
      await prisma.confirmationLog.update({
        where: { id: log.id },
        data: { repliedAt: new Date(), replyText: text, outcome: 'timeout' },
      });
      return { resolved: 'expired' as const };
    }
    if (parsed.otpCandidate === log.otpCode) {
      await prisma.confirmationLog.update({
        where: { id: log.id },
        data: { repliedAt: new Date(), replyText: text, outcome: 'confirmed' },
      });
      await changeOrderStatus({
        orderId: order.id,
        toStatus: 'confirmed',
        actorType: 'system',
        note: 'OTP verified',
      });
      void allocateForOrder(order.id).catch(() => {});
      return { resolved: 'confirmed' as const };
    }
    // Wrong OTP
    await prisma.confirmationLog.update({
      where: { id: log.id },
      data: { attempts: { increment: 1 }, replyText: text },
    });
    return { resolved: 'otp_mismatch' as const };
  }

  if (parsed.intent === 'confirm') {
    await prisma.confirmationLog.update({
      where: { id: log.id },
      data: { repliedAt: new Date(), replyText: text, outcome: 'confirmed' },
    });
    await changeOrderStatus({
      orderId: order.id,
      toStatus: 'confirmed',
      actorType: 'system',
      note: 'Customer confirmed via WA',
    });
    void allocateForOrder(order.id).catch(() => {});
    return { resolved: 'confirmed' as const };
  }

  // Unknown — leave open, increment attempts so CS can see customer engaged.
  await prisma.confirmationLog.update({
    where: { id: log.id },
    data: { attempts: { increment: 1 }, replyText: text },
  });
  return { resolved: 'unknown' as const };
}

/**
 * No-response policy executor. Called from the BullMQ worker when the
 * configured timeout fires. Picks one of three actions per the tenant config.
 */
export async function applyNoResponsePolicy(orderId: string, tenantId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { confirmationLogs: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!order || order.tenantId !== tenantId) return;
  if (order.status !== 'pending_confirmation') return; // already resolved

  const cfg = await prisma.riskEngineConfig.findUnique({ where: { tenantId } });
  const policy = cfg?.noResponsePolicy ?? 'auto_cancel';

  const log = order.confirmationLogs[0];
  if (log) {
    await prisma.confirmationLog.update({
      where: { id: log.id },
      data: { outcome: policy === 'auto_cancel' ? 'timeout' : policy === 'hold_for_cs' ? 'hold' : 'shipped_anyway' },
    });
  }

  if (policy === 'auto_cancel') {
    await changeOrderStatus({
      orderId: order.id,
      toStatus: 'cancelled_no_response',
      actorType: 'system',
      note: 'No response within timeout window',
    });
  } else if (policy === 'hold_for_cs') {
    await changeOrderStatus({
      orderId: order.id,
      toStatus: 'on_hold',
      actorType: 'system',
      note: 'No response — held for CS review',
    });
  } else {
    // ship_anyway
    await changeOrderStatus({
      orderId: order.id,
      toStatus: 'unconfirmed_shipped',
      actorType: 'system',
      note: 'No response — shipping anyway per seller policy',
    });
    void allocateForOrder(order.id).catch(() => {});
  }
}
