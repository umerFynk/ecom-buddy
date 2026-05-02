import http from 'http';
import { createApp } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { prisma } from '@/db/prisma';
import { startWorkers, stopWorkers } from '@/jobs';
import { shutdownQueues } from '@/jobs/queue';
import { attachSocketIo } from '@/modules/cs/cs.socket';

async function main() {
  const app = createApp();

  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('database connected');
  } catch (err) {
    logger.error({ err }, 'database connection failed at boot');
    if (env.NODE_ENV === 'production') process.exit(1);
  }

  // Boot in-process workers unless explicitly disabled (e.g. tests).
  if (process.env.WORKERS_ENABLED !== 'false') {
    try {
      await startWorkers();
    } catch (err) {
      logger.error({ err }, 'failed to start workers');
    }
  }

  const httpServer = http.createServer(app);
  attachSocketIo(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`${env.APP_NAME} backend listening on http://localhost:${env.PORT} (with Socket.io)`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    httpServer.close(async () => {
      await stopWorkers();
      await shutdownQueues();
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
