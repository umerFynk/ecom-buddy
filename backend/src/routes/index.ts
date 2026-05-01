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
import { riskRouter } from '@/modules/risk/risk.routes';
import { statusRouter } from '@/modules/status/status.routes';
import { apiKeysRouter } from '@/modules/api-keys/api-keys.routes';
import { shopifyRouter } from '@/modules/shopify/shopify.routes';
import { shopifyWebhookRouter } from '@/modules/shopify/shopify.webhooks';
import { adminRouter } from '@/modules/admin/admin.routes';
import { publicRouter } from '@/modules/public-api/public.routes';

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
  v1.use('/inventory', inventoryRouter);
  v1.use('/risk', riskRouter);
  v1.use('/status', statusRouter);
  v1.use('/api-keys', apiKeysRouter);

  // Shopify integration (OAuth uses JWT, webhooks use HMAC)
  v1.use('/shopify', shopifyRouter);

  // Admin panel routes (admin JWT)
  v1.use('/admin', adminRouter);

  // Public REST API (API key authenticated)
  v1.use('/public', publicRouter);

  v1.get('/', (_req, res) => ok(res, { version: 'v1', status: 'ok' }));

  app.use('/v1', v1);

  // Shopify webhook router is mounted under /v1/webhooks/shopify; raw body
  // parser is wired in app.ts before the JSON parser so HMAC works.
  app.use('/v1/webhooks/shopify', shopifyWebhookRouter);
}
