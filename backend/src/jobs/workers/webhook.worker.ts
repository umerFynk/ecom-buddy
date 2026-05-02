import { Worker } from 'bullmq';
import { makeWorker, QUEUES } from '@/jobs/queue';
import { deliverOnce } from '@/modules/webhooks/webhooks.service';

export interface WebhookDeliveryJob { deliveryId: string }

export function startWebhookWorker(): Worker<WebhookDeliveryJob> {
  return makeWorker<WebhookDeliveryJob>(
    QUEUES.WEBHOOK_DELIVERY,
    async (job) => {
      const r = await deliverOnce(job.data.deliveryId);
      return r;
    },
    { concurrency: 8 }
  );
}
