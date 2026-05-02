import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { encrypt } from '@/lib/encryption';
import { CourierType } from '@prisma/client';
import { rankCourierCandidates, recomputeSuccessRate7d } from './assignment';
import { bookOrder, bookOrdersBulk } from './booking';
import { buildAdapterForConfig } from './factory';

export const couriersRouter = Router();
couriersRouter.use(requireResellerAuth);

const COURIER_TYPES = ['postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier'] as const;

const CreateConfigSchema = z.object({
  courierType: z.enum(COURIER_TYPES),
  accountName: z.string().optional(),
  accountNo: z.string().optional(),
  apiKey: z.string().min(1),
  apiPassword: z.string().optional(),
  pickupAddress: z
    .object({
      contactName: z.string().optional(),
      contactPhone: z.string().optional(),
      city: z.string().min(1),
      addressLine1: z.string().min(1),
      addressLine2: z.string().optional(),
      postalCode: z.string().optional(),
    })
    .optional(),
  priority: z.number().int().min(0).max(1000).default(100),
  cityOverrides: z.record(z.string(), z.number().int()).optional(),
});

couriersRouter.get(
  '/configs',
  asyncHandler(async (req, res) => {
    const items = await prisma.courierConfig.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: [{ isActive: 'desc' }, { priority: 'asc' }],
      select: {
        id: true,
        courierType: true,
        accountName: true,
        accountNo: true,
        priority: true,
        successRate7d: true,
        cityOverrides: true,
        pickupAddress: true,
        isActive: true,
        createdAt: true,
      },
    });
    return ok(res, items);
  })
);

couriersRouter.post(
  '/configs',
  requireResellerRole(['owner', 'manager']),
  validate(CreateConfigSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const body = req.body as z.infer<typeof CreateConfigSchema>;

    const dup = await prisma.courierConfig.findFirst({
      where: { tenantId, courierType: body.courierType, accountNo: body.accountNo ?? null },
    });
    if (dup) throw new ConflictError('A courier config with this type+account already exists');

    const cfg = await prisma.courierConfig.create({
      data: {
        tenantId,
        courierType: body.courierType,
        accountName: body.accountName,
        accountNo: body.accountNo,
        apiKeyEncrypted: encrypt(body.apiKey),
        apiPasswordEncrypted: body.apiPassword ? encrypt(body.apiPassword) : null,
        pickupAddress: body.pickupAddress,
        priority: body.priority,
        cityOverrides: body.cityOverrides ?? {},
      },
    });
    return created(res, { id: cfg.id, courierType: cfg.courierType, priority: cfg.priority });
  })
);

const UpdateConfigSchema = z.object({
  accountName: z.string().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  cityOverrides: z.record(z.string(), z.number().int()).optional(),
  pickupAddress: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().optional(),
  apiKey: z.string().optional(),
  apiPassword: z.string().optional(),
});

couriersRouter.patch(
  '/configs/:id',
  requireResellerRole(['owner', 'manager']),
  validate(UpdateConfigSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const cfg = await prisma.courierConfig.findUnique({ where: { id: req.params.id! } });
    if (!cfg || cfg.tenantId !== tenantId) throw new NotFoundError('Courier config not found');
    const body = req.body as z.infer<typeof UpdateConfigSchema>;
    const updated = await prisma.courierConfig.update({
      where: { id: cfg.id },
      data: {
        ...(body.accountName !== undefined ? { accountName: body.accountName } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.cityOverrides !== undefined ? { cityOverrides: body.cityOverrides } : {}),
        ...(body.pickupAddress !== undefined ? { pickupAddress: body.pickupAddress } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.apiKey ? { apiKeyEncrypted: encrypt(body.apiKey) } : {}),
        ...(body.apiPassword ? { apiPasswordEncrypted: encrypt(body.apiPassword) } : {}),
      },
    });
    return ok(res, { id: updated.id, isActive: updated.isActive });
  })
);

couriersRouter.delete(
  '/configs/:id',
  requireResellerRole(['owner']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const cfg = await prisma.courierConfig.findUnique({ where: { id: req.params.id! } });
    if (!cfg || cfg.tenantId !== tenantId) throw new NotFoundError('Courier config not found');
    await prisma.courierConfig.update({ where: { id: cfg.id }, data: { isActive: false } });
    return ok(res, { archived: true });
  })
);

const RankSchema = z.object({ city: z.string().min(1) });

couriersRouter.post(
  '/rank',
  validate(RankSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const candidates = await rankCourierCandidates({ tenantId, city: req.body.city });
    return ok(
      res,
      candidates.map((c) => ({
        courierConfigId: c.config.id,
        courierType: c.config.courierType,
        accountName: c.config.accountName,
        priority: c.effectivePriority,
        reason: c.reason,
        successRate7d: c.config.successRate7d,
      }))
    );
  })
);

couriersRouter.post(
  '/recompute-success/:id',
  requireResellerRole(['owner', 'manager']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const cfg = await prisma.courierConfig.findUnique({ where: { id: req.params.id! } });
    if (!cfg || cfg.tenantId !== tenantId) throw new NotFoundError('Courier config not found');
    const rate = await recomputeSuccessRate7d(cfg.id);
    return ok(res, { successRate7d: rate });
  })
);

const BookSchema = z.object({
  orderId: z.string(),
  preferredCourierConfigId: z.string().optional(),
});

couriersRouter.post(
  '/book',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(BookSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.body.orderId } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    const result = await bookOrder({
      orderId: order.id,
      preferredCourierConfigId: req.body.preferredCourierConfigId,
      actorType: 'reseller_user',
      actorId: req.auth?.type === 'reseller' ? req.auth.userId : undefined,
    });
    return ok(res, result);
  })
);

const BulkBookSchema = z.object({
  orderIds: z.array(z.string()).min(1).max(500),
  preferredCourierConfigId: z.string().optional(),
});

couriersRouter.post(
  '/book/bulk',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(BulkBookSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const result = await bookOrdersBulk({
      tenantId,
      orderIds: req.body.orderIds,
      preferredCourierConfigId: req.body.preferredCourierConfigId,
      actorId: req.auth?.type === 'reseller' ? req.auth.userId : undefined,
    });
    return ok(res, result);
  })
);

const CancelSchema = z.object({ trackingNumber: z.string().min(1) });

couriersRouter.post(
  '/cancel',
  requireResellerRole(['owner', 'manager']),
  validate(CancelSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const shipment = await prisma.shipment.findUnique({
      where: { trackingNumber: req.body.trackingNumber },
      include: { order: true },
    });
    if (!shipment || shipment.tenantId !== tenantId) throw new NotFoundError('Shipment not found');
    const adapter = await buildAdapterForConfig(shipment.courierConfigId);
    const r = await adapter.cancelShipment(shipment.trackingNumber);
    if (r.success) {
      const { changeOrderStatus } = await import('../status/status.service');
      await changeOrderStatus({
        orderId: shipment.orderId,
        toStatus: 'cancelled_by_courier',
        actorType: 'reseller_user',
        actorId: req.auth?.type === 'reseller' ? req.auth.userId : undefined,
        note: 'Shipment cancelled with courier',
        force: true,
      });
    }
    return ok(res, r);
  })
);

const RatesSchema = z.object({
  courierConfigId: z.string(),
  weightKg: z.number().positive(),
  originCity: z.string(),
  destinationCity: z.string(),
  amount: z.number().nonnegative().default(0),
});

couriersRouter.post(
  '/rates',
  validate(RatesSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const cfg = await prisma.courierConfig.findUnique({ where: { id: req.body.courierConfigId } });
    if (!cfg || cfg.tenantId !== tenantId) throw new NotFoundError('Courier config not found');
    const adapter = await buildAdapterForConfig(cfg.id);
    const r = await adapter.getRates({
      weightKg: req.body.weightKg,
      originCity: req.body.originCity,
      destinationCity: req.body.destinationCity,
      amount: req.body.amount,
    });
    return ok(res, r);
  })
);
