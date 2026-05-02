import { Router } from 'express';
import { prisma } from '@/db/prisma';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { requireResellerAuth, requireResellerRole, requireAdminAuth, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { notifyAffectedCustomers, buildAdminOosDigest } from './inventory.oos';

export const oosRouter = Router();
oosRouter.use(requireResellerAuth);

oosRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const events = await prisma.oosEvent.findMany({
      where: { tenantId: tenantIdOf(req), resolvedAt: null },
      include: {
        store: { select: { id: true, name: true } },
        variant: { include: { product: { select: { title: true } } } },
      },
      orderBy: { triggeredAt: 'desc' },
    });
    return ok(res, events);
  })
);

oosRouter.post(
  '/events/:id/notify-customers',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const event = await prisma.oosEvent.findUnique({ where: { id: req.params.id! } });
    if (!event || event.tenantId !== tenantId) throw new NotFoundError('OOS event not found');
    const result = await notifyAffectedCustomers(event.id);
    return ok(res, result);
  })
);

oosRouter.post(
  '/events/:id/resolve',
  requireResellerRole(['owner', 'manager']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const event = await prisma.oosEvent.findUnique({ where: { id: req.params.id! } });
    if (!event || event.tenantId !== tenantId) throw new NotFoundError('OOS event not found');
    const updated = await prisma.oosEvent.update({
      where: { id: event.id },
      data: { resolvedAt: new Date() },
    });
    return ok(res, updated);
  })
);

// Admin: platform-wide digest (used by the daily worker + admin dashboard).
export const adminOosRouter = Router();
adminOosRouter.use(requireAdminAuth);

adminOosRouter.get(
  '/digest',
  asyncHandler(async (_req, res) => {
    const rows = await buildAdminOosDigest();
    return ok(res, rows);
  })
);
