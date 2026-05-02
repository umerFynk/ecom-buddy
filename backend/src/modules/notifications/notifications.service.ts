import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email';
import { getQueue, QUEUES } from '@/jobs/queue';
import type { WaSendJob } from '@/jobs/workers/wa.worker';
import { checkSendWindow } from '@/modules/businessHours/businessHours';
import { emitCsConversationUpdate } from '@/modules/cs/cs.socket';
import { getIo } from '@/modules/cs/cs.socket';

/**
 * Notification dispatcher. Looks up notification_settings for the tenant +
 * eventType, persists a Notification row, and fans out across enabled
 * channels (in-app, email, WhatsApp). Respects per-event quiet hours
 * (delegated to the business-hours gate the WA worker also uses).
 */

export interface DispatchInput {
  tenantId: string;
  eventType: string;
  title: string;
  body?: string;
  orderId?: string;
  /** Recipient overrides; defaults from tenant.email + first owner. */
  email?: string | string[];
  /** Phone for the WA channel (E.164 09xxxxxxxxx style). */
  phone?: string;
}

interface ResolvedSettings {
  enabled: boolean;
  channels: { wa: boolean; email: boolean; inapp: boolean };
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

async function resolveSettings(tenantId: string, eventType: string): Promise<ResolvedSettings> {
  const setting = await prisma.notificationSetting.findUnique({
    where: { tenantId_eventType: { tenantId, eventType } },
  });
  if (!setting) {
    // Sensible defaults — in-app + email on, WA off; no quiet hours.
    return { enabled: true, channels: { wa: false, email: true, inapp: true } };
  }
  return {
    enabled: setting.isEnabled,
    channels: { wa: setting.channelWa, email: setting.channelEmail, inapp: setting.channelInapp },
    quietHoursStart: setting.quietHoursStart,
    quietHoursEnd: setting.quietHoursEnd,
  };
}

async function defaultRecipients(tenantId: string): Promise<{ email: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return { email: tenant?.email ?? '' };
}

export async function dispatchNotification(input: DispatchInput): Promise<{ persisted: boolean; sentChannels: string[] }> {
  const settings = await resolveSettings(input.tenantId, input.eventType);
  if (!settings.enabled) return { persisted: false, sentChannels: [] };

  // 1. Always persist an in-app row (cheap; gives the dashboard a single source).
  const notif = await prisma.notification.create({
    data: {
      tenantId: input.tenantId,
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      orderId: input.orderId,
    },
  });

  const sent: string[] = [];

  // 2. In-app — broadcast over Socket.io so reseller dashboards see new bell.
  if (settings.channels.inapp) {
    const io = getIo();
    if (io) {
      io.to(`tenant:${input.tenantId}`).emit('notification:new', {
        id: notif.id,
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        orderId: input.orderId,
        createdAt: notif.createdAt,
      });
    }
    sent.push('inapp');
  }

  // 3. Email channel.
  if (settings.channels.email) {
    const recipients = input.email ?? (await defaultRecipients(input.tenantId)).email;
    if (recipients) {
      const r = await sendEmail({
        to: recipients,
        subject: input.title,
        html: `<p>${input.title}</p>${input.body ? `<p>${input.body}</p>` : ''}`,
        text: `${input.title}${input.body ? `\n\n${input.body}` : ''}`,
      });
      if (r.sent) sent.push('email');
    }
  }

  // 4. WhatsApp channel — gated by business hours / quiet hours.
  if (settings.channels.wa && input.phone) {
    const window = await checkSendWindow({ tenantId: input.tenantId, eventType: input.eventType });
    const queue = getQueue<WaSendJob>(QUEUES.WA_SEND);
    await queue.add(
      'notification',
      {
        tenantId: input.tenantId,
        phone: input.phone,
        respectBusinessHours: true,
        eventType: input.eventType,
        payload: { kind: 'text', text: `${input.title}${input.body ? `\n\n${input.body}` : ''}` },
      },
      {
        ...(window.allowedNow ? {} : { delay: Math.max(0, (window.deferUntil?.getTime() ?? Date.now()) - Date.now()) }),
        attempts: 3,
        removeOnComplete: 100,
      }
    );
    sent.push('wa');
  }

  logger.info({ tenantId: input.tenantId, eventType: input.eventType, sent }, 'notification_dispatched');
  return { persisted: true, sentChannels: sent };
}

/**
 * Helper used from the dashboard to mark a notification read.
 */
export async function markRead(tenantId: string, notificationId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, tenantId },
    data: { isRead: true },
  });
}

// Surface a small re-export so admin/CS can poke conv updates from this module.
export { emitCsConversationUpdate };
