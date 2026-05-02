import { Worker } from 'bullmq';
import { makeWorker, getQueue, QUEUES } from '@/jobs/queue';
import { pollAllOpenShipments } from '@/modules/couriers/tracking';
import { logger } from '@/lib/logger';

/** Tracking poller — repeats every 2 hours, sweeps all open shipments. */
export function startTrackingPollWorker(): Worker {
  return makeWorker(
    QUEUES.COURIER_TRACKING_POLL,
    async () => {
      const r = await pollAllOpenShipments({ sinceHours: 30 * 24, limit: 2000 });
      logger.info(r, 'tracking_poll_sweep_done');
      return r;
    },
    { concurrency: 1 }
  );
}

export async function scheduleTrackingPoll(): Promise<void> {
  const queue = getQueue(QUEUES.COURIER_TRACKING_POLL);
  await queue.add(
    'sweep',
    {},
    {
      repeat: { every: 2 * 60 * 60 * 1000 },
      jobId: 'tracking-poll-sweep',
      removeOnComplete: 50,
      removeOnFail: 50,
    }
  );
}
