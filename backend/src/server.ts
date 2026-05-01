import { createApp } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { prisma } from '@/db/prisma';

async function main() {
  const app = createApp();

  // Verify DB connectivity at boot — fail fast in production.
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('database connected');
  } catch (err) {
    logger.error({ err }, 'database connection failed at boot');
    if (env.NODE_ENV === 'production') process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`${env.APP_NAME} backend listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
