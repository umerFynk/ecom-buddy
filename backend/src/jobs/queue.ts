import { Queue, QueueOptions, Worker, WorkerOptions, Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';

/**
 * Single shared Redis connection for BullMQ. BullMQ requires
 * `maxRetriesPerRequest: null` on its connections.
 */

let _connection: IORedis | undefined;

export function getRedisConnection(): IORedis {
  if (_connection) return _connection;
  _connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  _connection.on('error', (err) => logger.error({ err }, 'redis_connection_error'));
  return _connection;
}

// ---------- Named queues (one per logical workload) ----------
export const QUEUES = {
  WA_SEND: 'wa-send',
  CONFIRMATION_TIMEOUT: 'confirmation-timeout',
  INVENTORY_SHOPIFY_SYNC: 'inventory-shopify-sync',
  OOS_DIGEST: 'oos-digest',
  COURIER_TRACKING_POLL: 'courier-tracking-poll',
  COURIER_COD_BATCH: 'courier-cod-batch',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const _queues = new Map<QueueName, Queue>();

export function getQueue<T = unknown>(name: QueueName, opts: Partial<QueueOptions> = {}): Queue<T> {
  const existing = _queues.get(name) as Queue<T> | undefined;
  if (existing) return existing;
  const q = new Queue<T>(name, { ...opts, connection: getRedisConnection() });
  _queues.set(name, q as unknown as Queue);
  return q;
}

export function makeWorker<T = unknown, R = unknown>(
  name: QueueName,
  processor: (job: Job<T, R>) => Promise<R>,
  opts: Partial<WorkerOptions> = {}
): Worker<T, R> {
  const w = new Worker<T, R>(name, processor, {
    ...opts,
    connection: getRedisConnection(),
    concurrency: opts.concurrency ?? 4,
  });
  w.on('failed', (job, err) =>
    logger.warn({ queue: name, jobId: job?.id, err: err.message }, 'job_failed')
  );
  w.on('error', (err) => logger.error({ queue: name, err }, 'worker_error'));
  return w;
}

export async function shutdownQueues(): Promise<void> {
  for (const q of _queues.values()) {
    try {
      await q.close();
    } catch (err) {
      logger.warn({ err }, 'queue_close_error');
    }
  }
  if (_connection) await _connection.quit();
}
