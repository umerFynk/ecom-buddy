# Ecom Buddy — security checklist

## Tenant scope (most important guarantee)
- Every DB query carries `tenantId` from middleware (`req.tenantId`), set
  from JWT or API key — never from the request body.
- AI assistant function calls hardcode `tenantId` at the call site, NOT
  the prompt — prompt injection cannot pivot tenants.
- API keys store SHA-256 hash only; full key shown ONCE on creation.

## Webhooks
- Shopify webhooks: HMAC-SHA256 verified against `SHOPIFY_WEBHOOK_SECRET`
  before any processing; idempotent on `X-Shopify-Webhook-Id`.
- Stripe webhooks: signature verified via `Stripe.webhooks.constructEvent`
  with `STRIPE_WEBHOOK_SECRET`.
- Outgoing webhooks: HMAC-SHA256 signed body via `X-Ecombuddy-Signature`;
  recipient verifies with the per-subscription secret returned ONCE on
  create.

## Secrets at rest
- Shopify access tokens + courier API keys/passwords encrypted with
  AES-256-GCM using `ENCRYPTION_KEY` (32-byte hex).
- JWT secret is a separate 16+ char string.

## Authentication
- Reseller + admin sessions: signed JWT (`HS256`), 7-day expiry, stored
  in `localStorage` on frontends. Issuer mints; no refresh tokens yet
  (Phase 11 if needed).
- Public API: `X-API-Key` header. Per-key rate limit (default 1000/hr).

## Public surfaces
- Customer tracking: signed-URL pattern `/v1/track/{orderId}/{sig}`
  where `sig = HMAC-SHA256(JWT_SECRET, orderId).slice(0,16)`.
  Phone number is masked in the response.

## Transport
- `helmet()` applied to all responses.
- CORS restricted to the three known portal URLs.
- Express `trust proxy` on (assumes Railway/Cloudflare front).

## Dependencies
- `npm audit` should be run before each release; current run = 0
  vulnerabilities reported.

## Pending hardening (Phase 11+)
- Add rotating refresh tokens for portal sessions.
- Move file storage from local `uploads/` to Cloudflare R2 with signed URLs.
- 2FA for admin users (`admin_users.two_factor_secret` column already in schema).
- Per-tenant export of audit log + GDPR-style customer-data delete.
