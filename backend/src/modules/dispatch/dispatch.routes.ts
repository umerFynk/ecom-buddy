import { Router } from 'express';
import path from 'path';
import express from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, fail } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { generatePicklist } from './pdf/picklist';
import { generatePackingSlip } from './pdf/packingSlip';
import { generateLoadSheet } from './pdf/loadSheet';
import { generateShipperAdvice } from './pdf/shipperAdvice';
import { changeOrderStatus } from '../status/status.service';
import { consumeOnDispatch } from '../inventory/inventory.alloc';

export const dispatchRouter = Router();
dispatchRouter.use(requireResellerAuth);

const PicklistSchema = z.object({
  orderIds: z.array(z.string()).min(1).max(500),
});

dispatchRouter.post(
  '/picklists',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(PicklistSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const result = await generatePicklist({ tenantId, orderIds: req.body.orderIds });
    return ok(res, result);
  })
);

const PackingSlipSchema = z.object({
  orderId: z.string(),
  format: z.enum(['thermal80', 'a4']).default('a4'),
  picklistId: z.string().optional(),
});

dispatchRouter.post(
  '/packing-slips',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(PackingSlipSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const result = await generatePackingSlip({
      tenantId,
      orderId: req.body.orderId,
      format: req.body.format,
      picklistId: req.body.picklistId,
    });
    return ok(res, result);
  })
);

const LoadSheetSchema = z.object({
  courierConfigId: z.string(),
  orderIds: z.array(z.string()).min(1).max(500),
});

dispatchRouter.post(
  '/load-sheets',
  requireResellerRole(['owner', 'manager']),
  validate(LoadSheetSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const result = await generateLoadSheet({
      tenantId,
      courierConfigId: req.body.courierConfigId,
      orderIds: req.body.orderIds,
    });
    return ok(res, result);
  })
);

const ShipperAdviceSchema = z.object({
  courierType: z.enum(['postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier']),
  orderIds: z.array(z.string()).min(1).max(500),
});

dispatchRouter.post(
  '/shipper-advice',
  requireResellerRole(['owner', 'manager']),
  validate(ShipperAdviceSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const result = await generateShipperAdvice({
      tenantId,
      courierType: req.body.courierType,
      orderIds: req.body.orderIds,
    });
    return ok(res, result);
  })
);

/**
 * Mark an order physically dispatched: transitions the order to "dispatched",
 * decrements inventory (allocated → consumed), and updates dispatchedAt.
 */
const MarkDispatchedSchema = z.object({ orderIds: z.array(z.string()).min(1).max(500) });

dispatchRouter.post(
  '/mark-dispatched',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(MarkDispatchedSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const orders = await prisma.order.findMany({ where: { id: { in: req.body.orderIds }, tenantId } });
    const results: Array<{ orderId: string; ok: boolean; error?: string }> = [];
    for (const o of orders) {
      try {
        await changeOrderStatus({
          orderId: o.id,
          toStatus: 'dispatched',
          actorType: 'reseller_user',
          actorId: req.auth?.type === 'reseller' ? req.auth.userId : undefined,
          note: 'Marked dispatched in Ecom Buddy',
        });
        await consumeOnDispatch(o.id);
        results.push({ orderId: o.id, ok: true });
      } catch (err) {
        results.push({ orderId: o.id, ok: false, error: (err as Error).message });
      }
    }
    return ok(res, { count: results.length, results });
  })
);

dispatchRouter.get(
  '/picklists',
  asyncHandler(async (req, res) => {
    const items = await prisma.picklist.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return ok(res, items);
  })
);

dispatchRouter.get(
  '/load-sheets',
  asyncHandler(async (req, res) => {
    const items = await prisma.loadSheet.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { batchDate: 'desc' },
      take: 100,
    });
    return ok(res, items);
  })
);

dispatchRouter.get(
  '/shipper-advice',
  asyncHandler(async (req, res) => {
    const items = await prisma.shipperAdvice.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { batchDate: 'desc' },
      take: 100,
    });
    return ok(res, items);
  })
);

/**
 * Static-file mount for generated PDFs. Phase 10 swaps this for R2 +
 * signed URLs; for now files are served from local uploads/.
 */
export const pdfStaticRouter = Router();
pdfStaticRouter.use('/pdfs', express.static(path.resolve(process.cwd(), 'uploads', 'pdfs')));
