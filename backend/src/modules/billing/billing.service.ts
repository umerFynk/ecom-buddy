import StripeNs from 'stripe';
import { prisma } from '@/db/prisma';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';

// Stripe v18 ships its types under a single default-export class; we alias
// instances + use `unknown` casts where the typed structures bring no value.
type StripeClient = InstanceType<typeof StripeNs>;
type StripeEvent = { type: string; data: { object: { metadata?: Record<string, string>; id?: string } } };

let _client: StripeClient | null = null;

function client(): StripeClient | null {
  if (!env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY === 'stub-stripe-secret-key') return null;
  if (_client) return _client;
  _client = new StripeNs(env.STRIPE_SECRET_KEY);
  return _client;
}

export interface PlanPricing {
  starter: { stripePriceId?: string; pkr: number };
  growth:  { stripePriceId?: string; pkr: number };
  scale:   { stripePriceId?: string; pkr: number };
}

export async function getPlanPricing(): Promise<PlanPricing> {
  const cfg = await prisma.platformConfig.findUnique({ where: { key: 'plans' } });
  const v = (cfg?.value as Record<string, { price_pkr: number; stripe_price_id?: string }>) ?? {};
  return {
    starter: { pkr: v.starter?.price_pkr ?? 0,     stripePriceId: v.starter?.stripe_price_id },
    growth:  { pkr: v.growth?.price_pkr  ?? 9999,  stripePriceId: v.growth?.stripe_price_id },
    scale:   { pkr: v.scale?.price_pkr   ?? 24999, stripePriceId: v.scale?.stripe_price_id },
  };
}

export async function createCheckoutSession(opts: {
  tenantId: string;
  plan: 'growth' | 'scale';
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url?: string; sessionId?: string; reason?: string }> {
  const stripe = client();
  if (!stripe) return { reason: 'Stripe is not configured (set STRIPE_SECRET_KEY).' };
  const pricing = await getPlanPricing();
  const price = pricing[opts.plan].stripePriceId;
  if (!price) return { reason: `No Stripe price id for plan ${opts.plan} (set platform_config.plans.${opts.plan}.stripe_price_id)` };

  const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId } });
  if (!tenant) return { reason: 'Tenant not found' };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    customer_email: tenant.email,
    metadata: { tenantId: opts.tenantId, plan: opts.plan },
    subscription_data: { metadata: { tenantId: opts.tenantId, plan: opts.plan } },
  });
  return { url: session.url ?? undefined, sessionId: session.id };
}

/**
 * Stripe webhook handler. Verifies signature with STRIPE_WEBHOOK_SECRET,
 * then on subscription create/update sets tenant.plan, on delete reverts
 * to starter.
 */
export async function handleStripeEvent(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
  const stripe = client();
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET === 'stub-stripe-webhook-secret') {
    return { received: false };
  }
  let event: StripeEvent;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET) as unknown as StripeEvent;
  } catch (err) {
    logger.warn({ err }, 'stripe_webhook_signature_failed');
    throw err;
  }

  const obj = event.data?.object ?? {};
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const tenantId = meta.tenantId;
  const plan = meta.plan as 'growth' | 'scale' | undefined;

  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      if (tenantId && plan) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { plan, settings: { stripeSubscriptionId: obj.id } as never },
        });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      if (tenantId) {
        await prisma.tenant.update({ where: { id: tenantId }, data: { plan: 'starter' } });
      }
      break;
    }
  }
  return { received: true };
}

/** Manual invoice creation — for hand-billed enterprise customers. */
export async function createManualInvoice(opts: {
  tenantId: string;
  amountPkr: number;
  description: string;
  dueDate?: Date;
  createdByAdminId: string;
}) {
  return prisma.platformConfig.upsert({
    where: { key: `manual_invoice:${opts.tenantId}:${Date.now()}` },
    create: {
      key: `manual_invoice:${opts.tenantId}:${Date.now()}`,
      value: {
        tenantId: opts.tenantId,
        amountPkr: opts.amountPkr,
        description: opts.description,
        dueDate: opts.dueDate?.toISOString(),
        createdByAdminId: opts.createdByAdminId,
        createdAt: new Date().toISOString(),
        status: 'open',
      } as never,
    },
    update: {},
  });
}
