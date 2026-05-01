import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireAdminRole, requireResellerAuth, requireAdminAuth } from '@/middleware/auth';
import { invalidateStatusCaches, listAllowedTransitionsFrom } from './status.service';

export const statusRouter = Router();

// Reseller-readable: list current status definitions.
statusRouter.get(
  '/definitions',
  requireResellerAuth,
  asyncHandler(async (_req, res) => {
    const defs = await prisma.orderStatusDefinition.findMany({ orderBy: { displayOrder: 'asc' } });
    return ok(res, defs);
  })
);

statusRouter.get(
  '/transitions/:from',
  requireResellerAuth,
  asyncHandler(async (req, res) => {
    const allowed = await listAllowedTransitionsFrom(req.params.from!);
    return ok(res, { from: req.params.from, allowed });
  })
);

// Admin-only mutations are mounted on /v1/admin/status (see admin.routes.ts).
// The shared schemas live here.

export const UpsertStatusDefinitionSchema = z.object({
  statusKey: z.string().min(1).max(64),
  displayName: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#888888'),
  type: z.enum(['active', 'failure', 'cancellation', 'special', 'terminal']).default('active'),
  isTerminal: z.boolean().default(false),
  isCancellation: z.boolean().default(false),
  displayOrder: z.number().int().default(100),
  description: z.string().optional(),
});

export const UpsertTransitionSchema = z.object({
  fromStatus: z.string().min(1),
  toStatus: z.string().min(1),
  isAllowed: z.boolean().default(true),
});

// Admin sub-routes (require super_admin)
export const adminStatusRouter = Router();

adminStatusRouter.use(requireAdminAuth, requireAdminRole(['super_admin']));

adminStatusRouter.post(
  '/definitions',
  validate(UpsertStatusDefinitionSchema),
  asyncHandler(async (req, res) => {
    const def = await prisma.orderStatusDefinition.upsert({
      where: { statusKey: req.body.statusKey },
      create: req.body,
      update: req.body,
    });
    invalidateStatusCaches();
    return ok(res, def);
  })
);

adminStatusRouter.delete(
  '/definitions/:key',
  asyncHandler(async (req, res) => {
    await prisma.orderStatusDefinition.delete({ where: { statusKey: req.params.key! } });
    invalidateStatusCaches();
    return ok(res, { deleted: true });
  })
);

adminStatusRouter.post(
  '/transitions',
  validate(UpsertTransitionSchema),
  asyncHandler(async (req, res) => {
    const t = await prisma.statusTransition.upsert({
      where: { fromStatus_toStatus: { fromStatus: req.body.fromStatus, toStatus: req.body.toStatus } },
      create: req.body,
      update: { isAllowed: req.body.isAllowed },
    });
    invalidateStatusCaches();
    return ok(res, t);
  })
);

adminStatusRouter.get(
  '/transitions',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.statusTransition.findMany();
    return ok(res, rows);
  })
);
