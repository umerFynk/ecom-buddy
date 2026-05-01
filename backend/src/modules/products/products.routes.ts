import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, created, paginate } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError, ConflictError } from '@/lib/errors';
import { generateSku } from '@/lib/sku';
import { pushSkusBackToShopify } from '../shopify/shopify.service';

export const productsRouter = Router();
productsRouter.use(requireResellerAuth);

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  storeId: z.string().optional(),
  q: z.string().optional(),
});

productsRouter.get(
  '/',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, pageSize, storeId, q } = req.query as unknown as z.infer<typeof ListQuery>;
    const where = {
      tenantId,
      ...(storeId ? { storeId } : {}),
      ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: { variants: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return ok(res, items, paginate(total, page, pageSize));
  })
);

productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id! },
      include: { variants: { include: { inventoryLevels: true } } },
    });
    if (!product || product.tenantId !== tenantIdOf(req)) throw new NotFoundError('Product not found');
    return ok(res, product);
  })
);

const CreateProductSchema = z.object({
  storeId: z.string(),
  title: z.string().min(1).max(255),
  cogs: z.number().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
  variants: z
    .array(
      z.object({
        sku: z.string().optional(),
        title: z.string().optional(),
        variantTitle: z.string().optional(),
        price: z.number().nonnegative().optional(),
        cogs: z.number().nonnegative().optional(),
        weightGrams: z.number().int().nonnegative().optional(),
      })
    )
    .min(1)
    .max(100),
});

productsRouter.post(
  '/',
  requireResellerRole(['owner', 'manager']),
  validate(CreateProductSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const body = req.body as z.infer<typeof CreateProductSchema>;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundError('Tenant not found');

    const product = await prisma.product.create({
      data: {
        tenantId,
        storeId: body.storeId,
        title: body.title,
        cogs: body.cogs,
        imageUrl: body.imageUrl,
      },
    });

    for (const v of body.variants) {
      const sku = v.sku?.trim() || generateSku({ tenantPrefix: tenant.prefix, productId: product.id, variantId: Math.random().toString(36).slice(2, 10) });
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku,
          title: v.title,
          variantTitle: v.variantTitle,
          price: v.price,
          cogs: v.cogs,
          weightGrams: v.weightGrams,
        },
      });
    }

    const full = await prisma.product.findUnique({ where: { id: product.id }, include: { variants: true } });
    return created(res, full);
  })
);

const UpdateVariantSkuSchema = z.object({ sku: z.string().min(1).max(120) });

productsRouter.patch(
  '/variants/:variantId/sku',
  requireResellerRole(['owner', 'manager']),
  validate(UpdateVariantSkuSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const variant = await prisma.productVariant.findUnique({
      where: { id: req.params.variantId! },
      include: { product: true },
    });
    if (!variant || variant.product.tenantId !== tenantId) throw new NotFoundError('Variant not found');

    // Unique-per-tenant SKU enforcement (since the DB index is per-product).
    const dup = await prisma.productVariant.findFirst({
      where: {
        sku: req.body.sku,
        product: { tenantId },
        NOT: { id: variant.id },
      },
    });
    if (dup) throw new ConflictError('SKU already in use within this tenant');

    const updated = await prisma.productVariant.update({
      where: { id: variant.id },
      data: { sku: req.body.sku },
    });

    if (variant.product.storeId && variant.shopifyVariantId) {
      void pushSkusBackToShopify(variant.product.storeId, [
        { shopifyVariantId: Number(variant.shopifyVariantId), sku: req.body.sku },
      ]).catch(() => {});
    }

    return ok(res, updated);
  })
);
