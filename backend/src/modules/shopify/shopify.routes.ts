import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, fail } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import {
  buildInstallUrl,
  exchangeCodeForToken,
  isValidShopDomain,
  signState,
  verifyOAuthCallbackHmac,
  verifyState,
} from './shopify.oauth';
import { completeInstall } from './shopify.service';

export const shopifyRouter = Router();

const InstallSchema = z.object({
  storeId: z.string().min(1),
  shopDomain: z.string().min(1),
});

// 1. Reseller hits this with their JWT → returns a redirect URL.
shopifyRouter.post(
  '/install',
  requireResellerAuth,
  requireResellerRole(['owner', 'manager']),
  validate(InstallSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { storeId, shopDomain } = req.body;
    if (!isValidShopDomain(shopDomain)) {
      return fail(res, 'shopDomain must be like myshop.myshopify.com', 400, 'invalid_shop_domain');
    }
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.tenantId !== tenantId) return fail(res, 'Store not found', 404, 'not_found');

    const state = signState({
      tenantId,
      storeId,
      nonce: Math.random().toString(36).slice(2),
      ts: Date.now(),
    });
    const url = buildInstallUrl(shopDomain, state);
    return ok(res, { redirectUrl: url });
  })
);

// 2. Shopify redirects here with ?code, ?shop, ?state, ?hmac, ?timestamp
shopifyRouter.get(
  '/oauth/callback',
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, string>;
    const { code, shop, state } = query;
    if (!code || !shop || !state) return fail(res, 'Missing code/shop/state', 400, 'missing_params');

    if (!verifyOAuthCallbackHmac(query)) return fail(res, 'OAuth HMAC mismatch', 401, 'oauth_hmac_mismatch');
    if (!isValidShopDomain(shop)) return fail(res, 'Invalid shop domain', 400, 'invalid_shop_domain');

    let payload;
    try {
      payload = verifyState(state);
    } catch (err) {
      return fail(res, 'Invalid state', 400, 'invalid_state');
    }

    const store = await prisma.store.findUnique({ where: { id: payload.storeId } });
    if (!store || store.tenantId !== payload.tenantId) return fail(res, 'Store not found', 404, 'not_found');

    const tokenRes = await exchangeCodeForToken(shop, code);
    await completeInstall({
      storeId: store.id,
      shopDomain: shop,
      accessToken: tokenRes.access_token,
      scope: tokenRes.scope,
    });

    return ok(res, { connected: true, shop });
  })
);
