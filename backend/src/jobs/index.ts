import { logger } from '@/lib/logger';
import { Worker } from 'bullmq';
import { startWaSendWorker } from './workers/wa.worker';
import { startConfirmationTimeoutWorker } from './workers/confirmation.worker';
import { startInventorySyncWorker } from './workers/inventorySync.worker';
import { startOosDigestWorker, scheduleDailyOosDigest } from './workers/oosDigest.worker';

let workers: Worker[] = [];

/**
 * Boot all in-process workers. Phase 10 will move these into a separate
 * Railway worker dyno; for now they live alongside the API.
 */
export async function startWorkers(): Promise<void> {
  if (workers.length > 0) return;
  workers = [
    startWaSendWorker(),
    startConfirmationTimeoutWorker(),
    startInventorySyncWorker(),
    startOosDigestWorker(),
  ];
  await scheduleDailyOosDigest().catch((err) => logger.warn({ err }, 'daily_oos_digest_schedule_failed'));
  logger.info({ count: workers.length }, 'workers_started');
}

export async function stopWorkers(): Promise<void> {
  for (const w of workers) {
    try {
      await w.close();
    } catch (err) {
      logger.warn({ err }, 'worker_close_error');
    }
  }
  workers = [];
}
