import { Worker } from 'bullmq';
import { makeWorker, getQueue, QUEUES } from '@/jobs/queue';
import { buildAdminOosDigest } from '@/modules/inventory/inventory.oos';
import { logger } from '@/lib/logger';

/**
 * Phase 2: build the digest and log it. Phase 5 wires Resend email delivery.
 */
export function startOosDigestWorker(): Worker {
  return makeWorker(
    QUEUES.OOS_DIGEST,
    async () => {
      const rows = await buildAdminOosDigest();
      logger.info({ count: rows.length, sample: rows.slice(0, 5) }, 'admin_oos_digest_built');
      return { count: rows.length };
    },
    { concurrency: 1 }
  );
}

/** Schedule the digest at 09:00 every day (Asia/Karachi). */
export async function scheduleDailyOosDigest(): Promise<void> {
  const queue = getQueue(QUEUES.OOS_DIGEST);
  await queue.add(
    'daily',
    {},
    {
      repeat: { pattern: '0 9 * * *', tz: 'Asia/Karachi' },
      jobId: 'daily-oos-digest',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
}
