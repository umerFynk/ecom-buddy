import crypto from 'crypto';

/**
 * Shopify HMAC verification.
 * Shopify sends `X-Shopify-Hmac-Sha256` (base64) computed over the raw request
 * body using the app's webhook secret. We recompute and compare in constant time.
 */
export function verifyShopifyHmac(rawBody: Buffer, headerHmac: string | undefined, secret: string): boolean {
  if (!headerHmac) return false;
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(headerHmac));
  } catch {
    return false;
  }
}

/**
 * Outgoing webhook signing (HMAC-SHA256, hex). Recipients verify by recomputing.
 */
export function signOutgoingWebhook(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}
