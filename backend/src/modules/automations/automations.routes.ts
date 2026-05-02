import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { getRuleLibrary, runAutomations } from './automations.service';

export const automationsRouter = Router();
automationsRouter.use(requireResellerAuth);

const ConditionSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'is_true', 'is_false']),
  value: z.any().optional(),
});

const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('change_status'), toStatus: z.string(), note: z.string().optional() }),
  z.object({ type: z.literal('add_tag'), tag: z.string() }),
  z.object({ type: z.literal('send_wa_template'), template: z.string(), variables: z.record(z.string(), z.string()).optional() }),
  z.object({ type: z.literal('send_email'), subject: z.string(), body: z.string() }),
  z.object({ type: z.literal('notify_user'), title: z.string(), body: z.string().optional() }),
  z.object({ type: z.literal('escalate_cs'), reason: z.string() }),
  z.object({ type: z.literal('fire_webhook'), eventType: z.string() }),
]);

const RuleSchema = z.object({
  name: z.string().min(1).max(120),
  trigger: z.enum([
    'order.created', 'order.status_changed', 'order.confirmed',
    'order.dispatched', 'order.delivered', 'order.rto_initiated',
    'order.cancelled', 'inventory.low_stock', 'inventory.oos',
    'customer.blacklisted',
  ]),
  conditions: z.array(ConditionSchema).default([]),
  actions: z.array(ActionSchema).min(1),
  isActive: z.boolean().default(true),
});

automationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await prisma.automationRule.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { createdAt: 'desc' },
    });
    return ok(res, items);
  })
);

automationsRouter.get(
  '/library',
  asyncHandler(async (_req, res) => ok(res, getRuleLibrary()))
);

automationsRouter.post(
  '/',
  requireResellerRole(['owner', 'manager']),
  validate(RuleSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const body = req.body as z.infer<typeof RuleSchema>;
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: body.name,
        trigger: body.trigger,
        conditions: body.conditions as never,
        actions: body.actions as never,
        isActive: body.isActive,
      },
    });
    return created(res, rule);
  })
);

automationsRouter.patch(
  '/:id',
  requireResellerRole(['owner', 'manager']),
  validate(RuleSchema.partial()),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const rule = await prisma.automationRule.findUnique({ where: { id: req.params.id! } });
    if (!rule || rule.tenantId !== tenantId) throw new NotFoundError('Rule not found');
    const body = req.body as Partial<z.infer<typeof RuleSchema>>;
    const updated = await prisma.automationRule.update({
      where: { id: rule.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.trigger !== undefined ? { trigger: body.trigger } : {}),
        ...(body.conditions !== undefined ? { conditions: body.conditions as never } : {}),
        ...(body.actions !== undefined ? { actions: body.actions as never } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    return ok(res, updated);
  })
);

automationsRouter.delete(
  '/:id',
  requireResellerRole(['owner', 'manager']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const rule = await prisma.automationRule.findUnique({ where: { id: req.params.id! } });
    if (!rule || rule.tenantId !== tenantId) throw new NotFoundError('Rule not found');
    await prisma.automationRule.delete({ where: { id: rule.id } });
    return ok(res, { deleted: true });
  })
);

const TestSchema = z.object({ trigger: z.string(), payload: z.record(z.string(), z.any()).default({}) });

automationsRouter.post(
  '/test',
  requireResellerRole(['owner', 'manager']),
  validate(TestSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const r = await runAutomations(req.body.trigger as never, tenantId, req.body.payload);
    return ok(res, r);
  })
);
