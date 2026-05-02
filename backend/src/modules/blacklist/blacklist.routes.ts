import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, paginate } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, requireAdminAuth, requireAdminRole, tenantIdOf } from '@/middleware/auth';
import { manualEscalate, overrideBlacklistedForOrder, submitAppeal, decideAppeal } from './blacklist.service';

export const blacklistRouter = Router();
blacklistRouter.use(requireResellerAuth);

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  level: z.enum(['clean', 'watch', 'high_risk', 'blacklisted', 'global']).optional(),
});

blacklistRouter.get(
  '/',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, pageSize, level } = req.query as unknown as z.infer<typeof ListQuery>;
    const where = level
      ? { tenantId, blacklistLevel: level }
      : { tenantId, blacklistLevel: { in: ['watch', 'high_risk', 'blacklisted', 'global'] as Array<'watch' | 'high_risk' | 'blacklisted' | 'global'> } };
    const [total, items] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: { blacklistLevel: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return ok(res, items, paginate(total, page, pageSize));
  })
);

const EscalateSchema = z.object({
  customerId: z.string(),
  level: z.enum(['watch', 'high_risk', 'blacklisted']),
  reason: z.string().min(3).max(500),
});

blacklistRouter.post(
  '/escalate',
  requireResellerRole(['owner', 'manager']),
  validate(EscalateSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const result = await manualEscalate({
      tenantId,
      customerId: req.body.customerId,
      level: req.body.level,
      reason: req.body.reason,
      actorId: req.auth?.type === 'reseller' ? req.auth.userId : 'system',
      actorType: 'reseller_user',
    });
    return ok(res, result);
  })
);

const OverrideSchema = z.object({
  orderId: z.string(),
  reason: z.string().min(10).max(1000),
  acknowledged: z.literal(true),
});

blacklistRouter.post(
  '/override',
  requireResellerRole(['owner', 'manager']),
  validate(OverrideSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const result = await overrideBlacklistedForOrder({
      tenantId,
      orderId: req.body.orderId,
      reason: req.body.reason,
      acknowledged: req.body.acknowledged,
      actorId: req.auth?.type === 'reseller' ? req.auth.userId : 'system',
    });
    return ok(res, result);
  })
);

const AppealSchema = z.object({
  customerId: z.string(),
  reason: z.string().min(10).max(2000),
  evidenceUrl: z.string().url().optional(),
});

blacklistRouter.post(
  '/appeals',
  requireResellerRole(['owner', 'manager']),
  validate(AppealSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const result = await submitAppeal({
      appellantTenantId: tenantId,
      customerId: req.body.customerId,
      reason: req.body.reason,
      evidenceUrl: req.body.evidenceUrl,
    });
    return ok(res, result);
  })
);

blacklistRouter.get(
  '/appeals',
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const items = await prisma.blacklistAppeal.findMany({
      where: { appellantTenantId: tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return ok(res, items);
  })
);

// Admin sub-routes (super_admin / account_manager)
export const adminBlacklistRouter = Router();
adminBlacklistRouter.use(requireAdminAuth, requireAdminRole(['super_admin']));

adminBlacklistRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await prisma.customer.findMany({
      where: { blacklistLevel: { in: ['blacklisted', 'global'] } },
      orderBy: { blacklistLevel: 'desc' },
      take: 500,
    });
    return ok(res, items);
  })
);

adminBlacklistRouter.get(
  '/appeals',
  asyncHandler(async (req, res) => {
    const items = await prisma.blacklistAppeal.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    return ok(res, items);
  })
);

const DecideAppealSchema = z.object({
  approve: z.boolean(),
  decisionNote: z.string().min(3).max(1000),
});

adminBlacklistRouter.post(
  '/appeals/:id/decide',
  validate(DecideAppealSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    await decideAppeal({
      appealId: req.params.id!,
      adminId: req.auth.adminId,
      approve: req.body.approve,
      decisionNote: req.body.decisionNote,
    });
    return ok(res, { decided: true });
  })
);
