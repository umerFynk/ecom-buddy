import { Express, Router } from 'express';
import { ok } from '@/lib/response';

// Module routers — each module exports a Router. Wired below.
import { authRouter } from '@/modules/auth/auth.routes';
import { storesRouter } from '@/modules/stores/stores.routes';
import { usersRouter } from '@/modules/users/users.routes';
import { productsRouter } from '@/modules/products/products.routes';
import { customersRouter } from '@/modules/customers/customers.routes';
import { ordersRouter } from '@/modules/orders/orders.routes';
import { inventoryRouter } from '@/modules/inventory/inventory.routes';
import { oosRouter, adminOosRouter } from '@/modules/inventory/oos.routes';
import { riskRouter } from '@/modules/risk/risk.routes';
import { statusRouter } from '@/modules/status/status.routes';
import { apiKeysRouter } from '@/modules/api-keys/api-keys.routes';
import { shopifyRouter } from '@/modules/shopify/shopify.routes';
import { shopifyWebhookRouter } from '@/modules/shopify/shopify.webhooks';
import { adminRouter } from '@/modules/admin/admin.routes';
import { publicRouter } from '@/modules/public-api/public.routes';
import { waRouter, waWebhookRouter } from '@/modules/wa/wa.routes';
import { confirmationRouter } from '@/modules/confirmation/confirmation.routes';
import { csvRouter } from '@/modules/csv/csv.routes';
import { couriersRouter } from '@/modules/couriers/couriers.routes';
import { trackingCodRouter } from '@/modules/couriers/cod.routes';
import { dispatchRouter, pdfStaticRouter } from '@/modules/dispatch/dispatch.routes';
import { rtoRouter } from '@/modules/rto/rto.routes';
import { blacklistRouter, adminBlacklistRouter } from '@/modules/blacklist/blacklist.routes';
import { csRouter, adminCsRouter } from '@/modules/cs/cs.routes';
import { campaignsRouter } from '@/modules/campaigns/campaigns.routes';
import { abandonedRouter } from '@/modules/abandoned/abandoned.routes';
import { financifyRouter } from '@/modules/financify/financify.routes';
import { reportsRouter } from '@/modules/reports/reports.routes';
import { notificationsRouter } from '@/modules/notifications/notifications.routes';
import { automationsRouter } from '@/modules/automations/automations.routes';
import { webhookSubscriptionsRouter } from '@/modules/webhooks/webhooks.routes';
import { aiRouter } from '@/modules/ai/ai.routes';
import { docsRouter } from '@/modules/docs/docs.routes';
import { supportRouter, adminSupportRouter } from '@/modules/support/support.routes';
import { internalChatRouter } from '@/modules/internalChat/internalChat.routes';
import { b2bRouter, b2bWebhookRouter } from '@/modules/b2b/b2b.routes';
import { adminDashboardRouter } from '@/modules/admin/dashboard.routes';

export function mountRoutes(app: Express) {
  const v1 = Router();

  // Auth (no tenant scope on signup/login)
  v1.use('/auth', authRouter);

  // Reseller dashboard routes (JWT-authenticated, tenant-scoped)
  v1.use('/stores', storesRouter);
  v1.use('/users', usersRouter);
  v1.use('/products', productsRouter);
  v1.use('/customers', customersRouter);
  v1.use('/orders', ordersRouter);
  v1.use('/orders/csv-import', csvRouter);
  v1.use('/inventory', inventoryRouter);
  v1.use('/inventory/oos', oosRouter);
  v1.use('/risk', riskRouter);
  v1.use('/status', statusRouter);
  v1.use('/api-keys', apiKeysRouter);
  v1.use('/wa', waRouter);
  v1.use('/confirmation', confirmationRouter);
  v1.use('/couriers', couriersRouter);
  v1.use('/couriers', trackingCodRouter);
  v1.use('/dispatch', dispatchRouter);
  v1.use('/rto', rtoRouter);
  v1.use('/blacklist', blacklistRouter);
  v1.use('/cs', csRouter);
  v1.use('/campaigns', campaignsRouter);
  v1.use('/abandoned', abandonedRouter);
  v1.use('/financify', financifyRouter);
  v1.use('/reports', reportsRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/automations', automationsRouter);
  v1.use('/webhooks/subscriptions', webhookSubscriptionsRouter);
  v1.use('/ai', aiRouter);
  v1.use('/docs', docsRouter);
  v1.use('/support', supportRouter);

  // Shopify integration (OAuth uses JWT, webhooks use HMAC)
  v1.use('/shopify', shopifyRouter);

  // Admin panel routes (admin JWT)
  v1.use('/admin', adminRouter);
  v1.use('/admin/oos', adminOosRouter);
  v1.use('/admin/blacklist', adminBlacklistRouter);
  v1.use('/admin/cs', adminCsRouter);
  v1.use('/admin/support', adminSupportRouter);
  v1.use('/admin/internal-chat', internalChatRouter);
  v1.use('/admin/b2b', b2bRouter);
  v1.use('/admin/dashboard', adminDashboardRouter);

  // Public REST API (API key authenticated)
  v1.use('/public', publicRouter);

  v1.get('/', (_req, res) => ok(res, { version: 'v1', status: 'ok' }));

  app.use('/v1', v1);

  // Shopify webhook router is mounted under /v1/webhooks/shopify; raw body
  // parser is wired in app.ts before the JSON parser so HMAC works.
  app.use('/v1/webhooks/shopify', shopifyWebhookRouter);

  // 360dialog WhatsApp webhook (regular JSON body — no HMAC at the parser level).
  app.use('/v1/webhooks/wa', waWebhookRouter);

  // 360dialog B2B WhatsApp webhook (separate System 2 number, account managers).
  app.use('/v1/webhooks/wa-b2b', b2bWebhookRouter);

  // Generated PDFs (Phase 3 — picklists, packing slips, load sheets, shipper advice).
  // Phase 10 will move this to Cloudflare R2 with signed URLs.
  app.use('/uploads', pdfStaticRouter);
}
