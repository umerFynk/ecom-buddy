import axios from 'axios';
import crypto from 'crypto';
import { env } from '@/config/env';

/**
 * Shopify OAuth (Authorization Code grant). Flow:
 *   1. Reseller clicks "Connect Shopify" → backend builds /authorize URL
 *      and redirects.
 *   2. Shopify redirects back with ?code, ?shop, ?state.
 *   3. Backend POSTs to /oauth/access_token to exchange code for permanent
 *      offline access token.
 *   4. Token is encrypted (encryption.ts) and stored on the Store row.
 *   5. Backend registers required webhooks against the store.
 *
 * State handling: HMAC-signed payload `{tenantId, storeId, nonce, ts}` so we
 * can verify origin without server-side state.
 */

const STATE_VALID_MS = 10 * 60 * 1000; // 10 min

export function buildInstallUrl(shopDomain: string, state: string): string {
  const url = new URL(`https://${shopDomain}/admin/oauth/authorize`);
  url.searchParams.set('client_id', env.SHOPIFY_API_KEY);
  url.searchParams.set('scope', env.SHOPIFY_APP_SCOPES);
  url.searchParams.set('redirect_uri', `${env.API_PUBLIC_URL}/v1/shopify/oauth/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('grant_options[]', 'per-user'); // optional
  return url.toString();
}

export interface OAuthState {
  tenantId: string;
  storeId: string;
  nonce: string;
  ts: number;
}

export function signState(payload: OAuthState): string {
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', env.SHOPIFY_API_SECRET).update(json).digest('hex');
  return Buffer.from(json).toString('base64url') + '.' + sig;
}

export function verifyState(state: string): OAuthState {
  const [b64, sig] = state.split('.');
  if (!b64 || !sig) throw new Error('malformed state');
  const json = Buffer.from(b64, 'base64url').toString('utf8');
  const expected = crypto.createHmac('sha256', env.SHOPIFY_API_SECRET).update(json).digest('hex');
  const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) throw new Error('state signature mismatch');
  const payload = JSON.parse(json) as OAuthState;
  if (Date.now() - payload.ts > STATE_VALID_MS) throw new Error('state expired');
  return payload;
}

/**
 * Verifies the HMAC parameter Shopify appends to the OAuth callback query
 * (different from webhook HMAC). All params except `hmac` and `signature`
 * are included, sorted alphabetically, joined as key=value pairs with `&`.
 */
export function verifyOAuthCallbackHmac(query: Record<string, string>): boolean {
  const { hmac, signature: _sig, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const computed = crypto.createHmac('sha256', env.SHOPIFY_API_SECRET).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmac));
  } catch {
    return false;
  }
}

export async function exchangeCodeForToken(shopDomain: string, code: string): Promise<{ access_token: string; scope: string }> {
  const res = await axios.post(`https://${shopDomain}/admin/oauth/access_token`, {
    client_id: env.SHOPIFY_API_KEY,
    client_secret: env.SHOPIFY_API_SECRET,
    code,
  });
  return res.data;
}

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
export function isValidShopDomain(domain: string): boolean {
  return SHOP_DOMAIN_RE.test(domain);
}
