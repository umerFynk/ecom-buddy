import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { refreshCodStatus, batchRefreshCod } from './cod';
import { pollShipment } from './tracking';

export const trackingCodRouter = Router();
trackingCodRouter.use(requireResellerAuth);

const PollSchema = z.object({ shipmentId: z.string() });

trackingCodRouter.post(
  '/tracking/poll',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(PollSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const shipment = await prisma.shipment.findUnique({ where: { id: req.body.shipmentId } });
    if (!shipment || shipment.tenantId !== tenantId) throw new NotFoundError('Shipment not found');
    const r = await pollShipment(shipment.id);
    return ok(res, r);
  })
);

const RefreshCodSchema = z.object({ orderId: z.string() });

trackingCodRouter.post(
  '/cod/refresh',
  requireResellerRole(['owner', 'manager']),
  validate(RefreshCodSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.body.orderId } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    const r = await refreshCodStatus(order.id);
    return ok(res, r);
  })
);

trackingCodRouter.post(
  '/cod/refresh-batch',
  requireResellerRole(['owner']),
  asyncHandler(async (_req, res) => {
    const r = await batchRefreshCod({ limit: 200 });
    return ok(res, r);
  })
);
