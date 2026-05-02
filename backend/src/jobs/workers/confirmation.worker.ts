import { Worker } from 'bullmq';
import { makeWorker, QUEUES } from '@/jobs/queue';
import { applyNoResponsePolicy } from '@/modules/confirmation/confirmation.service';
import { logger } from '@/lib/logger';

export interface ConfirmationTimeoutJob {
  orderId: string;
  tenantId: string;
}

export function startConfirmationTimeoutWorker(): Worker<ConfirmationTimeoutJob> {
  return makeWorker<ConfirmationTimeoutJob>(
    QUEUES.CONFIRMATION_TIMEOUT,
    async (job) => {
      try {
        await applyNoResponsePolicy(job.data.orderId, job.data.tenantId);
      } catch (err) {
        logger.warn({ err, orderId: job.data.orderId }, 'no_response_policy_failed');
        throw err;
      }
      return { ok: true };
    },
    { concurrency: 4 }
  );
}
