import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from '@/config/env';
import { ok } from '@/lib/response';
import { errorHandler, notFoundHandler } from '@/middleware/error';
import { mountRoutes } from '@/routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: [env.RESELLER_PORTAL_URL, env.ADMIN_PANEL_URL, env.TRACKING_PAGE_URL],
      credentials: true,
    })
  );

  // Shopify webhook routes need raw body for HMAC verification — they mount
  // their own express.raw() before the JSON parser. Everything else gets JSON.
  app.use('/v1/webhooks/shopify', express.raw({ type: '*/*', limit: '5mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (env.NODE_ENV !== 'test') {
    app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  app.get('/', (_req: Request, res: Response) =>
    ok(res, { name: env.APP_NAME, version: '0.1.0', status: 'ok' })
  );
  app.get('/health', (_req: Request, res: Response) =>
    ok(res, { status: 'healthy', uptime: process.uptime(), timestamp: new Date().toISOString() })
  );

  mountRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
