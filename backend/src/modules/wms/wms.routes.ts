import { Router } from 'express';
import { z } from 'zod';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireAdminAuth, requireAdminRole, requireResellerAuth, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { createLocation, createWarehouse, createZone, findLocationByBarcode, listLocations, listWarehouses, placeSkuAtLocation } from './wms.layout';
import { completeInbound, createInbound, listInbound, recordItemReceived, startReceiving } from './wms.inbound';
import { completePack, createPickTaskForOrder, listPackTasks, listPickTasks, scanPick } from './wms.pickPack';
import { listOutboundQueue, listRtoReceipts, receiveRto } from './wms.outboundRto';

// ---------- Admin (warehouse staff) routes ----------

export const wmsAdminRouter = Router();
wmsAdminRouter.use(requireAdminAuth, requireAdminRole(['super_admin', 'warehouse']));

const WarehouseSchema = z.object({ name: z.string().min(1).max(120), address: z.string().optional(), city: z.string().optional() });

wmsAdminRouter.get('/warehouses', asyncHandler(async (_req, res) => ok(res, await listWarehouses())));
wmsAdminRouter.post(
  '/warehouses',
  requireAdminRole(['super_admin']),
  validate(WarehouseSchema),
  asyncHandler(async (req, res) => created(res, await createWarehouse(req.body)))
);

const ZoneSchema = z.object({ warehouseId: z.string(), zoneCode: z.string().min(1).max(8), name: z.string().min(1).max(60) });
wmsAdminRouter.post('/zones', requireAdminRole(['super_admin']), validate(ZoneSchema), asyncHandler(async (req, res) => created(res, await createZone(req.body))));

const LocationSchema = z.object({ zoneId: z.string(), shelf: z.string().min(1).max(8), bin: z.string().min(1).max(8) });
wmsAdminRouter.post('/locations', requireAdminRole(['super_admin']), validate(LocationSchema), asyncHandler(async (req, res) => created(res, await createLocation(req.body))));

wmsAdminRouter.get(
  '/warehouses/:id/locations',
  asyncHandler(async (req, res) => ok(res, await listLocations(req.params.id!)))
);

const PlaceSkuSchema = z.object({ variantId: z.string(), locationId: z.string(), quantity: z.number().int().nonnegative() });
wmsAdminRouter.post(
  '/sku-locations',
  validate(PlaceSkuSchema),
  asyncHandler(async (req, res) => ok(res, await placeSkuAtLocation(req.body)))
);

wmsAdminRouter.get(
  '/locations/by-barcode/:barcode',
  asyncHandler(async (req, res) => {
    const loc = await findLocationByBarcode(req.params.barcode!);
    if (!loc) throw new NotFoundError('Location not found');
    return ok(res, loc);
  })
);

// Inbound (admin/warehouse staff side)

const ListInboundQuery = z.object({ status: z.string().optional() });
wmsAdminRouter.get('/inbound', validate(ListInboundQuery, 'query'), asyncHandler(async (req, res) => {
  const items = await listInbound('', { status: req.query.status as string | undefined });
  return ok(res, items);
}));

wmsAdminRouter.post(
  '/inbound/:id/start',
  asyncHandler(async (req, res) => ok(res, await startReceiving(req.params.id!)))
);

const ReceiveItemSchema = z.object({
  itemId: z.string(),
  receivedQty: z.number().int().nonnegative(),
  condition: z.string().optional(),
  photoUrl: z.string().url().optional(),
});

wmsAdminRouter.post(
  '/inbound/:id/items',
  validate(ReceiveItemSchema),
  asyncHandler(async (req, res) => ok(res, await recordItemReceived({ inboundId: req.params.id!, ...req.body })))
);

wmsAdminRouter.post(
  '/inbound/:id/complete',
  asyncHandler(async (req, res) => ok(res, await completeInbound(req.params.id!)))
);

// Pick tasks

const PickListQuery = z.object({ status: z.string().optional(), warehouseId: z.string().optional(), assignedToMe: z.coerce.boolean().default(false) });
wmsAdminRouter.get('/pick-tasks', validate(PickListQuery, 'query'), asyncHandler(async (req, res) => {
  if (req.auth?.type !== 'admin') return;
  const items = await listPickTasks({
    status: req.query.status as string | undefined,
    warehouseId: req.query.warehouseId as string | undefined,
    assignedToAdminId: req.query.assignedToMe ? req.auth.adminId : undefined,
  });
  return ok(res, items);
}));

const ScanPickSchema = z.object({
  taskId: z.string(),
  locationBarcode: z.string(),
  variantId: z.string(),
  qty: z.number().int().positive(),
});

wmsAdminRouter.post(
  '/pick-tasks/scan',
  validate(ScanPickSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const r = await scanPick({ ...req.body, scannedByAdminId: req.auth.adminId });
    return ok(res, r);
  })
);

// Pack tasks

const PackListQuery = z.object({ status: z.string().optional(), assignedToMe: z.coerce.boolean().default(false) });
wmsAdminRouter.get('/pack-tasks', validate(PackListQuery, 'query'), asyncHandler(async (req, res) => {
  if (req.auth?.type !== 'admin') return;
  const items = await listPackTasks({
    status: req.query.status as string | undefined,
    assignedToAdminId: req.query.assignedToMe ? req.auth.adminId : undefined,
  });
  return ok(res, items);
}));

const PackCompleteSchema = z.object({
  weightKg: z.number().positive(),
  photoUrl: z.string().url().optional(),
});

wmsAdminRouter.patch(
  '/pack-tasks/:id/complete',
  validate(PackCompleteSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const r = await completePack({
      taskId: req.params.id!,
      weightKg: req.body.weightKg,
      photoUrl: req.body.photoUrl,
      assignedToAdminId: req.auth.adminId,
    });
    return ok(res, r);
  })
);

// Outbound

wmsAdminRouter.get(
  '/outbound/queue',
  asyncHandler(async (req, res) => ok(res, await listOutboundQueue({ courierType: req.query.courier as string | undefined })))
);

// RTO returns

const ReceiveRtoSchema = z.object({
  orderId: z.string(),
  condition: z.enum(['good', 'damaged', 'unsellable']),
  restockedQty: z.number().int().nonnegative().optional(),
  writeOffQty: z.number().int().nonnegative().optional(),
  photoUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

wmsAdminRouter.post(
  '/rto/receive',
  validate(ReceiveRtoSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const r = await receiveRto({ ...req.body, scannedByAdminId: req.auth.adminId });
    return ok(res, r);
  })
);

wmsAdminRouter.get(
  '/rto/receipts',
  asyncHandler(async (_req, res) => ok(res, await listRtoReceipts({ sinceDays: 30 })))
);

// ---------- Reseller-facing 3PL views ----------

export const wmsResellerRouter = Router();
wmsResellerRouter.use(requireResellerAuth);

wmsResellerRouter.get(
  '/inbound',
  asyncHandler(async (req, res) => ok(res, await listInbound(tenantIdOf(req))))
);

const ResellerCreateInboundSchema = z.object({
  warehouseId: z.string(),
  expectedAt: z.coerce.date().optional(),
  items: z.array(z.object({ variantId: z.string(), expectedQty: z.number().int().positive() })).min(1),
});

wmsResellerRouter.post(
  '/inbound',
  validate(ResellerCreateInboundSchema),
  asyncHandler(async (req, res) => created(res, await createInbound({ tenantId: tenantIdOf(req), ...req.body })))
);

wmsResellerRouter.get(
  '/pick-tasks',
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const items = await listPickTasks({});
    // Filter to this tenant's orders only.
    const filtered = items.filter((i) => i.order && (i.order as { tenantId?: string }).tenantId !== undefined ? true : true);
    // Re-query filtered by tenant via a lookup on orders.
    const { prisma } = await import('@/db/prisma');
    const tenantOrders = await prisma.order.findMany({
      where: { tenantId, id: { in: filtered.map((i) => i.orderId) } },
      select: { id: true },
    });
    const tenantOrderIds = new Set(tenantOrders.map((o) => o.id));
    return ok(res, filtered.filter((i) => tenantOrderIds.has(i.orderId)));
  })
);

wmsResellerRouter.get(
  '/rto-receipts',
  asyncHandler(async (req, res) => ok(res, await listRtoReceipts({ tenantId: tenantIdOf(req), sinceDays: 60 })))
);

// Auto-create pick task on demand (called from confirmation handler when 3PL).
const AutoPickSchema = z.object({ orderId: z.string() });
wmsResellerRouter.post(
  '/pick-tasks/from-order',
  validate(AutoPickSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { prisma } = await import('@/db/prisma');
    const order = await prisma.order.findUnique({ where: { id: req.body.orderId } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    const task = await createPickTaskForOrder({ orderId: order.id });
    return ok(res, task ?? { skipped: 'not_3pl_store' });
  })
);
