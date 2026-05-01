import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { loadRiskConfig } from './risk.service';

export const riskRouter = Router();

riskRouter.use(requireResellerAuth);

riskRouter.get(
  '/config',
  asyncHandler(async (req, res) => {
    const cfg = await loadRiskConfig(tenantIdOf(req));
    return ok(res, cfg);
  })
);

const UpdateConfigSchema = z.object({
  mode: z.enum(['off', 'manual', 'ai_engine']).optional(),
  factorWeights: z
    .object({
      phone_invalid: z.number().int().min(0).max(50),
      address_incomplete: z.number().int().min(0).max(30),
      first_time_customer: z.number().int().min(0).max(20),
      order_value_above_city_avg_2x: z.number().int().min(0).max(30),
      night_order_2am_6am: z.number().int().min(0).max(15),
    })
    .partial()
    .optional(),
  otpThreshold: z.number().int().min(0).max(100).optional(),
  csThreshold: z.number().int().min(0).max(100).optional(),
  cancelThreshold: z.number().int().min(0).max(100).optional(),
  noResponsePolicy: z.enum(['auto_cancel', 'hold_for_cs', 'ship_anyway']).optional(),
  noResponseHours: z.number().int().min(1).max(168).optional(),
});

riskRouter.patch(
  '/config',
  requireResellerRole(['owner', 'manager']),
  validate(UpdateConfigSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const body = req.body as z.infer<typeof UpdateConfigSchema>;
    const updated = await prisma.riskEngineConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        mode: body.mode ?? 'manual',
        factorWeights: body.factorWeights ?? {},
        otpThreshold: body.otpThreshold ?? 70,
        csThreshold: body.csThreshold ?? 80,
        cancelThreshold: body.cancelThreshold ?? 95,
        noResponsePolicy: body.noResponsePolicy ?? 'auto_cancel',
        noResponseHours: body.noResponseHours ?? 24,
      },
      update: {
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.factorWeights ? { factorWeights: body.factorWeights } : {}),
        ...(body.otpThreshold !== undefined ? { otpThreshold: body.otpThreshold } : {}),
        ...(body.csThreshold !== undefined ? { csThreshold: body.csThreshold } : {}),
        ...(body.cancelThreshold !== undefined ? { cancelThreshold: body.cancelThreshold } : {}),
        ...(body.noResponsePolicy ? { noResponsePolicy: body.noResponsePolicy } : {}),
        ...(body.noResponseHours !== undefined ? { noResponseHours: body.noResponseHours } : {}),
      },
    });
    return ok(res, updated);
  })
);

const ConditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'is_true', 'is_false']),
  value: z.any().optional(),
});

const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), value: z.number() }),
  z.object({ type: z.literal('set'), value: z.number().int().min(0).max(100) }),
  z.object({ type: z.literal('flag'), value: z.string().min(1).max(64) }),
]);

const RuleSchema = z.object({
  name: z.string().min(1).max(120),
  conditions: z.array(ConditionSchema).min(1),
  actions: z.array(ActionSchema).min(1),
  priority: z.number().int().default(100),
  isActive: z.boolean().default(true),
});

riskRouter.get(
  '/rules',
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const rules = await prisma.riskCustomRule.findMany({ where: { tenantId }, orderBy: { priority: 'asc' } });
    return ok(res, rules);
  })
);

riskRouter.post(
  '/rules',
  requireResellerRole(['owner', 'manager']),
  validate(RuleSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const rule = await prisma.riskCustomRule.create({
      data: { tenantId, ...req.body },
    });
    return ok(res, rule, undefined, 201);
  })
);

riskRouter.patch(
  '/rules/:id',
  requireResellerRole(['owner', 'manager']),
  validate(RuleSchema.partial()),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const rule = await prisma.riskCustomRule.update({
      where: { id: req.params.id! },
      data: req.body,
    });
    if (rule.tenantId !== tenantId) throw new Error('tenant mismatch');
    return ok(res, rule);
  })
);

riskRouter.delete(
  '/rules/:id',
  requireResellerRole(['owner', 'manager']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const rule = await prisma.riskCustomRule.findUnique({ where: { id: req.params.id! } });
    if (!rule || rule.tenantId !== tenantId) throw new Error('not found');
    await prisma.riskCustomRule.delete({ where: { id: rule.id } });
    return ok(res, { deleted: true });
  })
);
