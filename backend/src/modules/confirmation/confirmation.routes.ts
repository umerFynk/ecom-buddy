import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { runConfirmationFor, applyNoResponsePolicy } from './confirmation.service';

export const confirmationRouter = Router();
confirmationRouter.use(requireResellerAuth);

confirmationRouter.get(
  '/pending',
  asyncHandler(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: { tenantId: tenantIdOf(req), status: 'pending_confirmation' },
      include: { confirmationLogs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return ok(res, orders);
  })
);

const RunSchema = z.object({ orderId: z.string() });

confirmationRouter.post(
  '/run',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(RunSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.body.orderId } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    const decision = await runConfirmationFor(order.id);
    return ok(res, decision);
  })
);

confirmationRouter.post(
  '/no-response/:orderId',
  requireResellerRole(['owner', 'manager']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId! } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    await applyNoResponsePolicy(order.id, tenantId);
    return ok(res, { applied: true });
  })
);
