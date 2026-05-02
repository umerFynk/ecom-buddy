import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '@/db/prisma';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { fail, ok } from '@/lib/response';
import { verifyShopifyHmac } from '@/lib/hmac';
import {
  cancelOrderFromWebhook,
  ingestOrderFromWebhook,
  syncProductFromWebhook,
  uninstallApp,
} from './shopify.service';

// IMPORTANT: This router is mounted with express.raw() in app.ts so HMAC
// verification can run against the unparsed body.
//
// URL pattern: /v1/webhooks/shopify/<topic-with-slash-replaced-by-dash>
//   e.g. /v1/webhooks/shopify/orders-create

export const shopifyWebhookRouter = Router();

interface VerifiedWebhook {
  topic: string;
  shopDomain: string;
  webhookId: string;
  bodyJson: Record<string, unknown>;
}

declare global {
  namespace Express {
    interface Request {
      shopifyWebhook?: VerifiedWebhook;
    }
  }
}

async function verifyAndParseShopifyWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.body as Buffer;
    const headerHmac = req.header('X-Shopify-Hmac-Sha256');
    const topic = req.header('X-Shopify-Topic') ?? '';
    const shopDomain = req.header('X-Shopify-Shop-Domain') ?? '';
    const webhookId = req.header('X-Shopify-Webhook-Id') ?? '';

    if (!Buffer.isBuffer(raw)) {
      return fail(res, 'Webhook body must be raw buffer (mount express.raw)', 400, 'webhook_no_raw');
    }
    if (!verifyShopifyHmac(raw, headerHmac, env.SHOPIFY_WEBHOOK_SECRET)) {
      logger.warn({ topic, shopDomain }, 'shopify webhook HMAC mismatch');
      return fail(res, 'HMAC verification failed', 401, 'webhook_hmac_mismatch');
    }
    if (!webhookId) {
      return fail(res, 'Missing X-Shopify-Webhook-Id', 400, 'webhook_no_id');
    }

    // Idempotency: try to claim the webhook id. If it already exists we ack.
    const existing = await prisma.webhookEvent.findUnique({
      where: { source_externalId: { source: 'shopify', externalId: webhookId } },
    });
    if (existing) {
      logger.info({ webhookId, topic }, 'shopify webhook already processed (ack)');
      return ok(res, { idempotent: true });
    }
    await prisma.webhookEvent.create({
      data: { source: 'shopify', externalId: webhookId, topic },
    });

    let bodyJson: Record<string, unknown> = {};
    try {
      bodyJson = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    } catch {
      return fail(res, 'Webhook body is not valid JSON', 400, 'webhook_invalid_json');
    }

    req.shopifyWebhook = { topic, shopDomain, webhookId, bodyJson };
    next();
  } catch (err) {
    next(err);
  }
}

shopifyWebhookRouter.use(verifyAndParseShopifyWebhook);

async function findStoreByDomain(domain: string) {
  return prisma.store.findFirst({ where: { shopifyDomain: domain } });
}

async function markProcessed(webhookId: string, error?: string) {
  await prisma.webhookEvent.updateMany({
    where: { source: 'shopify', externalId: webhookId },
    data: { processedAt: new Date(), ...(error ? { error } : {}) },
  });
}

shopifyWebhookRouter.post('/orders-create', async (req, res, next) => {
  try {
    const w = req.shopifyWebhook!;
    const store = await findStoreByDomain(w.shopDomain);
    if (!store) {
      await markProcessed(w.webhookId, 'no store for domain');
      return ok(res, { ignored: 'no store for domain' });
    }
    const order = await ingestOrderFromWebhook(store.id, w.bodyJson as never);
    // If this order corresponds to an abandoned checkout, mark it recovered.
    const body = w.bodyJson as { checkout_token?: string };
    if (body.checkout_token) {
      try {
        const { markRecoveredFromOrder } = await import('@/modules/abandoned/abandoned.service');
        await markRecoveredFromOrder({ tenantId: store.tenantId, checkoutToken: body.checkout_token, orderId: order.id });
      } catch {
        /* swallow */
      }
    }
    await markProcessed(w.webhookId);
    return ok(res, { ok: true });
  } catch (err) {
    await markProcessed(req.shopifyWebhook!.webhookId, (err as Error).message);
    next(err);
  }
});

shopifyWebhookRouter.post('/checkouts-create', async (req, res, next) => {
  try {
    const w = req.shopifyWebhook!;
    const store = await findStoreByDomain(w.shopDomain);
    if (!store) {
      await markProcessed(w.webhookId, 'no store');
      return ok(res, { ignored: 'no store' });
    }
    const { ingestAbandonedCheckout } = await import('@/modules/abandoned/abandoned.service');
    await ingestAbandonedCheckout(store.id, w.bodyJson as never);
    await markProcessed(w.webhookId);
    return ok(res, { ok: true });
  } catch (err) {
    await markProcessed(req.shopifyWebhook!.webhookId, (err as Error).message);
    next(err);
  }
});

shopifyWebhookRouter.post('/checkouts-update', async (req, res, next) => {
  try {
    const w = req.shopifyWebhook!;
    const store = await findStoreByDomain(w.shopDomain);
    if (!store) {
      await markProcessed(w.webhookId, 'no store');
      return ok(res, { ignored: 'no store' });
    }
    const { ingestAbandonedCheckout } = await import('@/modules/abandoned/abandoned.service');
    await ingestAbandonedCheckout(store.id, w.bodyJson as never);
    await markProcessed(w.webhookId);
    return ok(res, { ok: true });
  } catch (err) {
    await markProcessed(req.shopifyWebhook!.webhookId, (err as Error).message);
    next(err);
  }
});

shopifyWebhookRouter.post('/orders-updated', async (req, res, next) => {
  try {
    const w = req.shopifyWebhook!;
    const store = await findStoreByDomain(w.shopDomain);
    if (!store) {
      await markProcessed(w.webhookId, 'no store');
      return ok(res, { ignored: 'no store' });
    }
    // Re-ingest is idempotent (upsert with no-op update).
    await ingestOrderFromWebhook(store.id, w.bodyJson as never);
    await markProcessed(w.webhookId);
    return ok(res, { ok: true });
  } catch (err) {
    await markProcessed(req.shopifyWebhook!.webhookId, (err as Error).message);
    next(err);
  }
});

shopifyWebhookRouter.post('/orders-cancelled', async (req, res, next) => {
  try {
    const w = req.shopifyWebhook!;
    const store = await findStoreByDomain(w.shopDomain);
    if (!store) {
      await markProcessed(w.webhookId, 'no store');
      return ok(res, { ignored: 'no store' });
    }
    await cancelOrderFromWebhook(store.id, w.bodyJson as never);
    await markProcessed(w.webhookId);
    return ok(res, { ok: true });
  } catch (err) {
    await markProcessed(req.shopifyWebhook!.webhookId, (err as Error).message);
    next(err);
  }
});

shopifyWebhookRouter.post('/products-create', async (req, res, next) => {
  try {
    const w = req.shopifyWebhook!;
    const store = await findStoreByDomain(w.shopDomain);
    if (!store) {
      await markProcessed(w.webhookId, 'no store');
      return ok(res, { ignored: 'no store' });
    }
    await syncProductFromWebhook(store.id, w.bodyJson as never);
    await markProcessed(w.webhookId);
    return ok(res, { ok: true });
  } catch (err) {
    await markProcessed(req.shopifyWebhook!.webhookId, (err as Error).message);
    next(err);
  }
});

shopifyWebhookRouter.post('/products-update', async (req, res, next) => {
  try {
    const w = req.shopifyWebhook!;
    const store = await findStoreByDomain(w.shopDomain);
    if (!store) {
      await markProcessed(w.webhookId, 'no store');
      return ok(res, { ignored: 'no store' });
    }
    await syncProductFromWebhook(store.id, w.bodyJson as never);
    await markProcessed(w.webhookId);
    return ok(res, { ok: true });
  } catch (err) {
    await markProcessed(req.shopifyWebhook!.webhookId, (err as Error).message);
    next(err);
  }
});

shopifyWebhookRouter.post('/app-uninstalled', async (req, res, next) => {
  try {
    const w = req.shopifyWebhook!;
    await uninstallApp(w.shopDomain);
    await markProcessed(w.webhookId);
    return ok(res, { ok: true });
  } catch (err) {
    await markProcessed(req.shopifyWebhook!.webhookId, (err as Error).message);
    next(err);
  }
});
