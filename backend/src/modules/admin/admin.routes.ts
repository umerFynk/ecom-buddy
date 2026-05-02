import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireAdminAuth, requireAdminRole } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { adminStatusRouter } from '../status/status.routes';
import { createAdminUser } from '../auth/auth.service';

export const adminRouter = Router();
adminRouter.use(requireAdminAuth);

// Status manager (super_admin only) — namespaced under /v1/admin/status/...
adminRouter.use('/status', adminStatusRouter);

// All resellers list
adminRouter.get(
  '/resellers',
  requireAdminRole(['super_admin', 'account_manager']),
  asyncHandler(async (_req, res) => {
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        plan: true,
        prefix: true,
        trialEndsAt: true,
        isActive: true,
        createdAt: true,
        _count: { select: { stores: true, orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return ok(res, tenants);
  })
);

adminRouter.get(
  '/resellers/:id',
  requireAdminRole(['super_admin', 'account_manager']),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id! },
      include: { stores: true, _count: { select: { orders: true, customers: true, users: true } } },
    });
    if (!tenant) throw new NotFoundError('Reseller not found');
    return ok(res, tenant);
  })
);

const UpdateTenantSchema = z.object({
  plan: z.enum(['starter', 'growth', 'scale']).optional(),
  isActive: z.boolean().optional(),
  threePlEnabled: z.boolean().optional(),
  trialEndsAt: z.coerce.date().optional(),
});

adminRouter.patch(
  '/resellers/:id',
  requireAdminRole(['super_admin']),
  validate(UpdateTenantSchema),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.update({ where: { id: req.params.id! }, data: req.body });
    return ok(res, tenant);
  })
);

// Admin users management (super_admin only)
const CreateAdminSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  role: z.enum(['super_admin', 'account_manager', 'cs_agent', 'warehouse']),
  name: z.string().optional(),
});

adminRouter.post(
  '/admin-users',
  requireAdminRole(['super_admin']),
  validate(CreateAdminSchema),
  asyncHandler(async (req, res) => {
    const u = await createAdminUser(req.body);
    return created(res, { id: u.id, email: u.email, role: u.role, name: u.name });
  })
);

adminRouter.get(
  '/admin-users',
  requireAdminRole(['super_admin']),
  asyncHandler(async (_req, res) => {
    const users = await prisma.adminUser.findMany({
      select: { id: true, email: true, role: true, name: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return ok(res, users);
  })
);

// Platform config
adminRouter.get(
  '/platform-config',
  requireAdminRole(['super_admin']),
  asyncHandler(async (_req, res) => {
    const cfg = await prisma.platformConfig.findMany();
    return ok(res, cfg);
  })
);

const PutConfigSchema = z.object({
  key: z.string().min(1),
  value: z.any(),
});

adminRouter.put(
  '/platform-config',
  requireAdminRole(['super_admin']),
  validate(PutConfigSchema),
  asyncHandler(async (req, res) => {
    const row = await prisma.platformConfig.upsert({
      where: { key: req.body.key },
      create: { key: req.body.key, value: req.body.value },
      update: { value: req.body.value },
    });
    return ok(res, row);
  })
);

// City aliases (admin-managed)
const CityAliasSchema = z.object({
  canonicalName: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  tier: z.number().int().min(1).max(4).default(1),
  province: z.string().optional(),
  courierZone: z.string().optional(),
});

adminRouter.get(
  '/cities',
  requireAdminRole(['super_admin']),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.cityAlias.findMany({ orderBy: { canonicalName: 'asc' } });
    return ok(res, rows);
  })
);

adminRouter.post(
  '/cities',
  requireAdminRole(['super_admin']),
  validate(CityAliasSchema),
  asyncHandler(async (req, res) => {
    const row = await prisma.cityAlias.upsert({
      where: { canonicalName: req.body.canonicalName },
      create: req.body,
      update: req.body,
    });
    // city cache lives in lib/cityNormalize.ts — invalidate it so new aliases work immediately.
    const { invalidateCityCache } = await import('@/lib/cityNormalize');
    invalidateCityCache();
    return ok(res, row);
  })
);

// Courier status mapping
const CourierMapSchema = z.object({
  courierType: z.enum(['postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier']),
  rawStatus: z.string().min(1),
  masterStatus: z.string().min(1),
});

adminRouter.get(
  '/courier-status-maps',
  requireAdminRole(['super_admin']),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.courierStatusMap.findMany();
    return ok(res, rows);
  })
);

adminRouter.post(
  '/courier-status-maps',
  requireAdminRole(['super_admin']),
  validate(CourierMapSchema),
  asyncHandler(async (req, res) => {
    const row = await prisma.courierStatusMap.upsert({
      where: { courierType_rawStatus: { courierType: req.body.courierType, rawStatus: req.body.rawStatus } },
      create: req.body,
      update: { masterStatus: req.body.masterStatus },
    });
    // Retroactively resolve any open orders that were stuck on this raw status.
    const { reResolveUnmapped } = await import('@/modules/couriers/statusMapping');
    const reRes = await reResolveUnmapped(req.body.courierType, req.body.rawStatus);
    return ok(res, { ...row, reResolved: reRes.resolved });
  })
);

adminRouter.get(
  '/courier-status-unmapped',
  requireAdminRole(['super_admin']),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.courierStatusUnmapped.findMany({ where: { resolvedAt: null }, orderBy: { receivedAt: 'desc' } });
    return ok(res, rows);
  })
);
