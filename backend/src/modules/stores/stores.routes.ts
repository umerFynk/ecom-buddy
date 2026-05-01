import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';

export const storesRouter = Router();
storesRouter.use(requireResellerAuth);

const CreateStoreSchema = z.object({
  name: z.string().min(2).max(100),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().url().optional(),
  timezone: z.string().default('Asia/Karachi'),
  businessHoursStart: z.string().optional(),
  businessHoursEnd: z.string().optional(),
});

const UpdateStoreSchema = CreateStoreSchema.partial().extend({
  dispatchMode: z.enum(['self', 'ecombuddy_3pl', 'ecombuddy_courier_account']).optional(),
  confirmationMode: z.enum(['off', 'manual', 'ai_engine']).optional(),
  wmsEnabled: z.boolean().optional(),
  customDomain: z.string().optional(),
  hideEbBranding: z.boolean().optional(),
  reviewLink: z.string().url().optional().or(z.literal('')),
  fieldMapping: z.record(z.string(), z.string()).optional(),
});

storesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const stores = await prisma.store.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { createdAt: 'asc' },
    });
    return ok(res, stores);
  })
);

storesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.id! } });
    if (!store || store.tenantId !== tenantIdOf(req)) throw new NotFoundError('Store not found');
    return ok(res, store);
  })
);

storesRouter.post(
  '/',
  requireResellerRole(['owner', 'manager']),
  validate(CreateStoreSchema),
  asyncHandler(async (req, res) => {
    const store = await prisma.store.create({
      data: { tenantId: tenantIdOf(req), ...req.body },
    });
    return created(res, store);
  })
);

storesRouter.patch(
  '/:id',
  requireResellerRole(['owner', 'manager']),
  validate(UpdateStoreSchema),
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.id! } });
    if (!store || store.tenantId !== tenantIdOf(req)) throw new NotFoundError('Store not found');
    const updated = await prisma.store.update({ where: { id: store.id }, data: req.body });
    return ok(res, updated);
  })
);

storesRouter.delete(
  '/:id',
  requireResellerRole(['owner']),
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.id! } });
    if (!store || store.tenantId !== tenantIdOf(req)) throw new NotFoundError('Store not found');
    await prisma.store.update({ where: { id: store.id }, data: { isActive: false } });
    return ok(res, { archived: true });
  })
);
