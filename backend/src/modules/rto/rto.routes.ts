import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { runRescueFlow, tagRtoReason } from './rto.service';

export const rtoRouter = Router();
rtoRouter.use(requireResellerAuth);

rtoRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const items = await prisma.order.findMany({
      where: {
        tenantId,
        OR: [
          { status: 'rto_initiated' },
          { status: 'rto_in_transit' },
          { status: 'failed_delivery' },
        ],
      },
      include: { customer: { select: { id: true, name: true, phoneNormalized: true, blacklistLevel: true } } },
      orderBy: [{ amount: 'desc' }, { rtoAt: 'desc' }],
      take: 200,
    });
    return ok(res, items);
  })
);

const ClassifySchema = z.object({ orderId: z.string(), text: z.string().optional() });

rtoRouter.post(
  '/classify',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(ClassifySchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.body.orderId } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    const result = await tagRtoReason(order.id, req.body.text ?? null);
    return ok(res, result);
  })
);

const RescueSchema = z.object({ orderId: z.string() });

rtoRouter.post(
  '/rescue',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(RescueSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.body.orderId } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    const result = await runRescueFlow(order.id, req.auth?.type === 'reseller' ? req.auth.userId : undefined);
    return ok(res, result);
  })
);
