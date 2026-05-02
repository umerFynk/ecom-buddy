import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from backend/, then fall back to repo root.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

const EnvSchema = z.object({
  APP_NAME: z.string().default('Ecom Buddy'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  RESELLER_PORTAL_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_PANEL_URL: z.string().url().default('http://localhost:3001'),
  TRACKING_PAGE_URL: z.string().url().default('http://localhost:3002'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),

  SHOPIFY_API_KEY: z.string().default('stub-shopify-api-key'),
  SHOPIFY_API_SECRET: z.string().default('stub-shopify-api-secret'),
  SHOPIFY_APP_SCOPES: z.string().default('read_products,write_products,read_orders,write_orders,read_inventory,write_inventory,read_customers'),
  SHOPIFY_API_VERSION: z.string().default('2024-10'),
  SHOPIFY_WEBHOOK_SECRET: z.string().default('stub-shopify-webhook-secret'),

  OPENAI_API_KEY: z.string().default('stub-openai-api-key'),
  OPENAI_MODEL: z.string().default('gpt-4o'),

  RESEND_API_KEY: z.string().default('stub-resend-api-key'),
  EMAIL_FROM: z.string().default('Ecom Buddy <noreply@ecombuddy.pk>'),

  DIALOG360_API_BASE: z.string().default('https://waba.360dialog.io'),
  DIALOG360_SHARED_CUSTOMER_API_KEY: z.string().default('stub-360dialog-shared-customer-key'),
  DIALOG360_B2B_API_KEY: z.string().default('stub-360dialog-b2b-key'),

  // Courier adapters — platform-level fallback creds. Per-tenant creds live
  // encrypted in courier_configs and override these.
  POSTEX_API_BASE: z.string().default('https://api.postex.pk'),
  POSTEX_PLATFORM_TOKEN: z.string().default('stub-postex-token'),
  LEOPARDS_API_BASE: z.string().default('https://merchantapi.leopardscourier.com'),
  LEOPARDS_PLATFORM_API_KEY: z.string().default('stub-leopards-key'),
  LEOPARDS_PLATFORM_API_PASSWORD: z.string().default('stub-leopards-password'),
  TRAX_API_BASE: z.string().default('https://api.trax.pk'),
  TRAX_PLATFORM_TOKEN: z.string().default('stub-trax-token'),
  BLUEEX_API_BASE: z.string().default('https://benapi.blue-ex.com'),
  BLUEEX_PLATFORM_USER: z.string().default('stub-blueex-user'),
  BLUEEX_PLATFORM_PASSWORD: z.string().default('stub-blueex-password'),
  MNX_API_BASE: z.string().default('https://api.mnx.com.pk'),
  MNX_PLATFORM_TOKEN: z.string().default('stub-mnx-token'),
  CALLCOURIER_API_BASE: z.string().default('https://api.callcourier.com.pk'),
  CALLCOURIER_PLATFORM_TOKEN: z.string().default('stub-callcourier-token'),

  // Stripe billing (optional — stub keys disable real charges)
  STRIPE_SECRET_KEY: z.string().default('stub-stripe-secret-key'),
  STRIPE_WEBHOOK_SECRET: z.string().default('stub-stripe-webhook-secret'),

  // Sentry (optional — empty disables)
  SENTRY_DSN: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
