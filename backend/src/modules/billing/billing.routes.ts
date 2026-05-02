import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { ok, fail } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, requireAdminAuth, requireAdminRole, tenantIdOf } from '@/middleware/auth';
import { createCheckoutSession, createManualInvoice, getPlanPricing, handleStripeEvent } from './billing.service';

export const billingRouter = Router();
billingRouter.use(requireResellerAuth);

billingRouter.get('/plans', asyncHandler(async (_req, res) => ok(res, await getPlanPricing())));

const CheckoutSchema = z.object({
  plan: z.enum(['growth', 'scale']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

billingRouter.post(
  '/checkout',
  requireResellerRole(['owner']),
  validate(CheckoutSchema),
  asyncHandler(async (req, res) => {
    const r = await createCheckoutSession({ tenantId: tenantIdOf(req), ...req.body });
    if (!r.url) return fail(res, r.reason ?? 'Stripe not configured', 503, 'stripe_unavailable');
    return ok(res, r);
  })
);

// Admin: manual invoices
export const adminBillingRouter = Router();
adminBillingRouter.use(requireAdminAuth, requireAdminRole(['super_admin']));

const ManualInvoiceSchema = z.object({
  tenantId: z.string(),
  amountPkr: z.number().positive(),
  description: z.string().min(3),
  dueDate: z.coerce.date().optional(),
});

adminBillingRouter.post(
  '/manual-invoices',
  validate(ManualInvoiceSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const r = await createManualInvoice({ ...req.body, createdByAdminId: req.auth.adminId });
    return ok(res, r);
  })
);

// Stripe webhook — needs raw body (mounted with express.raw before JSON parser
// in app.ts). Path: /v1/webhooks/stripe
export const stripeWebhookRouter = Router();
stripeWebhookRouter.post(
  '/',
  express.raw({ type: '*/*' }),
  asyncHandler(async (req, res) => {
    const sig = req.header('stripe-signature') ?? '';
    const raw = req.body as Buffer;
    try {
      const r = await handleStripeEvent(raw, sig);
      return ok(res, r);
    } catch {
      return fail(res, 'Stripe signature verification failed', 400, 'stripe_sig_failed');
    }
  })
);
