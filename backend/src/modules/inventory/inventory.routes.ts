import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, paginate } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';

export const inventoryRouter = Router();
inventoryRouter.use(requireResellerAuth);

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  storeId: z.string().optional(),
  lowStockOnly: z.coerce.boolean().optional(),
});

inventoryRouter.get(
  '/levels',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, pageSize, storeId, lowStockOnly } = req.query as unknown as z.infer<typeof ListQuery>;
    const where = {
      tenantId,
      ...(storeId ? { storeId } : {}),
    };
    const items = await prisma.inventoryLevel.findMany({
      where,
      include: { variant: { include: { product: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const filtered = lowStockOnly
      ? items.filter((i) => i.totalStock - i.allocatedStock <= i.lowStockThreshold)
      : items;
    const total = await prisma.inventoryLevel.count({ where });
    return ok(res, filtered, paginate(total, page, pageSize));
  })
);

const SetLevelSchema = z.object({
  variantId: z.string(),
  storeId: z.string(),
  totalStock: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
});

inventoryRouter.post(
  '/levels',
  requireResellerRole(['owner', 'manager']),
  validate(SetLevelSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const variant = await prisma.productVariant.findUnique({
      where: { id: req.body.variantId },
      include: { product: true },
    });
    if (!variant || variant.product.tenantId !== tenantId) throw new NotFoundError('Variant not found');

    const before = await prisma.inventoryLevel.findUnique({
      where: { variantId_storeId: { variantId: req.body.variantId, storeId: req.body.storeId } },
    });

    const level = await prisma.inventoryLevel.upsert({
      where: { variantId_storeId: { variantId: req.body.variantId, storeId: req.body.storeId } },
      create: {
        tenantId,
        variantId: req.body.variantId,
        storeId: req.body.storeId,
        totalStock: req.body.totalStock,
        lowStockThreshold: req.body.lowStockThreshold ?? 5,
      },
      update: {
        totalStock: req.body.totalStock,
        ...(req.body.lowStockThreshold !== undefined ? { lowStockThreshold: req.body.lowStockThreshold } : {}),
      },
    });

    const delta = req.body.totalStock - (before?.totalStock ?? 0);
    if (delta !== 0) {
      await prisma.inventoryMovement.create({
        data: {
          variantId: req.body.variantId,
          type: 'adjustment',
          quantity: delta,
          reason: req.body.reason ?? 'Manual adjustment',
        },
      });
    }
    return ok(res, level);
  })
);

inventoryRouter.get(
  '/movements/:variantId',
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const variant = await prisma.productVariant.findUnique({
      where: { id: req.params.variantId! },
      include: { product: true },
    });
    if (!variant || variant.product.tenantId !== tenantId) throw new NotFoundError('Variant not found');
    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId: variant.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return ok(res, movements);
  })
);
