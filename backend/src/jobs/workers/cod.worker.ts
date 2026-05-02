import { Worker } from 'bullmq';
import { makeWorker, getQueue, QUEUES } from '@/jobs/queue';
import { batchRefreshCod } from '@/modules/couriers/cod';
import { logger } from '@/lib/logger';

/** COD remittance status batch — repeats every 4 hours. */
export function startCodBatchWorker(): Worker {
  return makeWorker(
    QUEUES.COURIER_COD_BATCH,
    async () => {
      const r = await batchRefreshCod({});
      logger.info(r, 'cod_batch_sweep_done');
      return r;
    },
    { concurrency: 1 }
  );
}

export async function scheduleCodBatch(): Promise<void> {
  const queue = getQueue(QUEUES.COURIER_COD_BATCH);
  await queue.add(
    'sweep',
    {},
    {
      repeat: { every: 4 * 60 * 60 * 1000 },
      jobId: 'cod-batch-sweep',
      removeOnComplete: 50,
      removeOnFail: 50,
    }
  );
}
