import { makeWorker, QUEUES } from '@/jobs/queue';
import { sendTemplateMessage, sendTextMessage } from '@/modules/wa/wa.service';
import { checkSendWindow, delayMs } from '@/modules/businessHours/businessHours';
import { TemplateKey } from '@/modules/wa/wa.templates';
import { logger } from '@/lib/logger';
import { Worker } from 'bullmq';
import { WaSystem } from '@prisma/client';

export interface WaSendJob {
  tenantId: string;
  storeId?: string;
  phone: string;
  orderId?: string;
  system?: WaSystem;
  /** When false, business-hours gate is skipped (urgent: OTP, security alerts). */
  respectBusinessHours?: boolean;
  /** For "event_type"-keyed quiet-hours lookup. */
  eventType?: string;
  payload:
    | { kind: 'template'; template: TemplateKey; variables: Record<string, string> }
    | { kind: 'text'; text: string };
}

/**
 * WA send worker. Each job:
 *   1. Checks the send window (business hours + quiet hours).
 *   2. If outside window AND respectBusinessHours = true → reschedule itself
 *      with a delay until the next window opens.
 *   3. Otherwise sends via wa.service.
 */
export function startWaSendWorker(): Worker<WaSendJob> {
  return makeWorker<WaSendJob>(
    QUEUES.WA_SEND,
    async (job) => {
      const data = job.data;

      const respect = data.respectBusinessHours ?? true;
      if (respect) {
        const window = await checkSendWindow({
          tenantId: data.tenantId,
          storeId: data.storeId,
          eventType: data.eventType,
        });
        if (!window.allowedNow) {
          const delay = delayMs(window, 30);
          logger.info({ jobId: job.id, deferUntil: window.deferUntil }, 'wa_send_deferred');
          await job.moveToDelayed(Date.now() + delay);
          return { deferred: true };
        }
      }

      if (data.payload.kind === 'template') {
        const res = await sendTemplateMessage({
          tenantId: data.tenantId,
          phone: data.phone,
          template: data.payload.template,
          variables: data.payload.variables,
          orderId: data.orderId,
          system: data.system,
        });
        return { sent: true, waMessageId: res.waMessageId };
      }
      const res = await sendTextMessage({
        tenantId: data.tenantId,
        phone: data.phone,
        text: data.payload.text,
        orderId: data.orderId,
        system: data.system,
      });
      return { sent: true, waMessageId: res.waMessageId };
    },
    { concurrency: 8 }
  );
}
