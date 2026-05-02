import * as Sentry from '@sentry/node';
import { env } from '@/config/env';
import { logger } from './logger';

let _initialized = false;

/** Initialise Sentry if SENTRY_DSN is set. No-ops otherwise so dev stays quiet. */
export function initSentry(): void {
  if (_initialized) return;
  if (!env.SENTRY_DSN) {
    logger.info('sentry_dsn_not_set_skipping_init');
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0.0,
  });
  _initialized = true;
  logger.info('sentry_initialized');
}

export function captureException(err: unknown, ctx?: Record<string, unknown>): void {
  if (!_initialized) return;
  Sentry.captureException(err, ctx ? { extra: ctx } : undefined);
}
