import crypto from 'crypto';
import axios from 'axios';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { signOutgoingWebhook } from '@/lib/hmac';
import { getQueue, QUEUES } from '@/jobs/queue';

/**
 * Outgoing webhooks (BLUEPRINT.md Part 23).
 *
 * Retry schedule: now → +5 min → +30 min → +2 h → +24 h → exhausted.
 * HMAC: X-Ecombuddy-Signature = sha256(secret, raw_body) hex.
 */

const RETRY_BACKOFF_MIN = [0, 5, 30, 120, 24 * 60]; // attempts 1..5

export function generateSubscriptionSecret(): string {
  return `wh_${crypto.randomBytes(24).toString('base64url')}`;
}

/**
 * Fan-out a single event to every active subscription that wants it. Each
 * subscription gets its own WebhookDelivery row + a queued send job.
 */
export async function dispatchEvent(opts: { tenantId: string; eventType: string; payload: Record<string, unknown> }): Promise<{ subscriptions: number }> {
  const subs = await prisma.webhookSubscription.findMany({
    where: { tenantId: opts.tenantId, isActive: true, events: { has: opts.eventType } },
  });
  if (subs.length === 0) return { subscriptions: 0 };

  const queue = getQueue(QUEUES.WEBHOOK_DELIVERY);
  for (const sub of subs) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        subscriptionId: sub.id,
        eventType: opts.eventType,
        payload: opts.payload as Prisma.InputJsonValue,
        status: 'pending',
      },
    });
    await queue.add(
      'deliver',
      { deliveryId: delivery.id },
      {
        jobId: `delivery-${delivery.id}-1`,
        attempts: 1, // we handle retries ourselves so we can persist the delivery row state
        removeOnComplete: 200,
        removeOnFail: 200,
      }
    );
  }
  return { subscriptions: subs.length };
}

/**
 * Deliver one queued WebhookDelivery row. POSTs the JSON body to the URL
 * with HMAC + event-type headers; on failure schedules the next retry, or
 * marks the delivery exhausted.
 */
export async function deliverOnce(deliveryId: string): Promise<{ ok: boolean; status?: number }> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { subscription: true },
  });
  if (!delivery) return { ok: false };
  if (delivery.status === 'delivered' || delivery.status === 'exhausted') return { ok: true, status: delivery.responseCode ?? 200 };

  await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'sending', attempts: { increment: 1 } } });

  const body = JSON.stringify({
    event: delivery.eventType,
    occurredAt: delivery.createdAt.toISOString(),
    delivery: delivery.id,
    data: delivery.payload,
  });
  const signature = signOutgoingWebhook(body, delivery.subscription.secret);

  try {
    const res = await axios.post(delivery.subscription.url, body, {
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        'X-Ecombuddy-Event': delivery.eventType,
        'X-Ecombuddy-Signature': signature,
        'X-Ecombuddy-Delivery-Id': delivery.id,
        'User-Agent': 'EcomBuddy-Webhooks/1',
        ...((delivery.subscription.headers as Record<string, string> | null) ?? {}),
      },
      validateStatus: () => true,
    });
    const okStatus = res.status >= 200 && res.status < 300;
    if (okStatus) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'delivered',
          responseCode: res.status,
          responseBody: typeof res.data === 'string' ? res.data.slice(0, 500) : JSON.stringify(res.data ?? {}).slice(0, 500),
          deliveredAt: new Date(),
        },
      });
      await prisma.webhookSubscription.update({
        where: { id: delivery.subscription.id },
        data: { lastSuccessAt: new Date(), failureCount: 0 },
      });
      return { ok: true, status: res.status };
    }
    await scheduleRetryOrExhaust(delivery.id, delivery.subscription.id, delivery.attempts + 1, res.status, JSON.stringify(res.data ?? {}).slice(0, 500));
    return { ok: false, status: res.status };
  } catch (err) {
    await scheduleRetryOrExhaust(delivery.id, delivery.subscription.id, delivery.attempts + 1, undefined, (err as Error).message);
    return { ok: false };
  }
}

async function scheduleRetryOrExhaust(deliveryId: string, subscriptionId: string, nextAttempt: number, statusCode?: number, body?: string) {
  const backoff = RETRY_BACKOFF_MIN[nextAttempt - 1];
  if (backoff === undefined) {
    // Exhausted
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'exhausted',
        responseCode: statusCode,
        responseBody: body,
      },
    });
    await prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { lastFailureAt: new Date(), failureCount: { increment: 1 } },
    });
    logger.warn({ deliveryId }, 'webhook_delivery_exhausted');
    return;
  }
  const next = new Date(Date.now() + backoff * 60 * 1000);
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'pending',
      responseCode: statusCode,
      responseBody: body,
      nextRetryAt: next,
    },
  });
  await prisma.webhookSubscription.update({
    where: { id: subscriptionId },
    data: { lastFailureAt: new Date(), failureCount: { increment: 1 } },
  });
  const queue = getQueue(QUEUES.WEBHOOK_DELIVERY);
  await queue.add(
    'deliver',
    { deliveryId },
    {
      jobId: `delivery-${deliveryId}-${nextAttempt}`,
      delay: backoff * 60 * 1000,
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 200,
    }
  );
}

export async function listSubscriptions(tenantId: string) {
  return prisma.webhookSubscription.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
}

export async function listDeliveries(tenantId: string, subscriptionId?: string, limit = 100) {
  return prisma.webhookDelivery.findMany({
    where: {
      subscription: { tenantId },
      ...(subscriptionId ? { subscriptionId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
