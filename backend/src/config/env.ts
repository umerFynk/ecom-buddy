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
