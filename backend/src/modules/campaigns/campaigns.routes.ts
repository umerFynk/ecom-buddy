import { Router } from 'express';
import { z } from 'zod';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { createCampaign, estimateAudience, getCampaign, launchCampaign, listCampaigns } from './campaigns.service';
import type { AudienceFilter } from './campaigns.service';

export const campaignsRouter = Router();
campaignsRouter.use(requireResellerAuth);

const AudienceSchema = z.object({
  city: z.union([z.string(), z.array(z.string())]).optional(),
  blacklistMaxLevel: z.enum(['clean', 'watch', 'high_risk']).optional(),
  minOrders: z.number().int().min(0).optional(),
  maxOrders: z.number().int().min(0).optional(),
  isVip: z.boolean().optional(),
  lastOrderAfter: z.string().datetime().optional(),
  lastOrderBefore: z.string().datetime().optional(),
  tag: z.string().optional(),
});

campaignsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await listCampaigns(tenantIdOf(req));
    return ok(res, items);
  })
);

campaignsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const c = await getCampaign(tenantIdOf(req), req.params.id!);
    if (!c) throw new NotFoundError('Campaign not found');
    return ok(res, c);
  })
);

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  audienceFilter: AudienceSchema,
  templateId: z.string().optional(),
  scheduledAt: z.coerce.date().optional(),
});

campaignsRouter.post(
  '/',
  requireResellerRole(['owner', 'manager']),
  validate(CreateSchema),
  asyncHandler(async (req, res) => {
    const c = await createCampaign({
      tenantId: tenantIdOf(req),
      name: req.body.name,
      audienceFilter: req.body.audienceFilter,
      templateId: req.body.templateId,
      scheduledAt: req.body.scheduledAt,
    });
    return created(res, c);
  })
);

campaignsRouter.post(
  '/estimate',
  requireResellerRole(['owner', 'manager']),
  validate(AudienceSchema),
  asyncHandler(async (req, res) => {
    const r = await estimateAudience(tenantIdOf(req), req.body as AudienceFilter);
    return ok(res, r);
  })
);

const LaunchSchema = z.object({
  template: z.enum([
    'order_confirmation_request',
    'order_otp_request',
    'order_confirmed',
    'order_dispatched',
    'order_delivered',
    'order_cancelled_no_response',
    'order_oos_apology',
  ]),
  variableTemplate: z.record(z.string(), z.string()).optional(),
});

campaignsRouter.post(
  '/:id/launch',
  requireResellerRole(['owner', 'manager']),
  validate(LaunchSchema),
  asyncHandler(async (req, res) => {
    const r = await launchCampaign({
      tenantId: tenantIdOf(req),
      campaignId: req.params.id!,
      template: req.body.template,
      variableTemplate: req.body.variableTemplate,
    });
    return ok(res, r);
  })
);
