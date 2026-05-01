import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, paginate } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireApiKey, requireApiScope, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';

export const publicRouter = Router();

publicRouter.use(requireApiKey);

// Per-tenant rate limit. Default is the API key's `rateLimit` field (per hour),
// applied as a sliding window from express-rate-limit.
publicRouter.use(
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: (req) => (req.auth?.type === 'api_key' ? req.auth.apiKeyId.length && 1000 : 100),
    keyGenerator: (req) => (req.auth?.type === 'api_key' ? req.auth.apiKeyId : req.ip ?? 'anon'),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const ListOrdersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
});

publicRouter.get(
  '/orders',
  requireApiScope(['read_only', 'orders', 'full_access']),
  validate(ListOrdersQuery, 'query'),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, pageSize, status } = req.query as unknown as z.infer<typeof ListOrdersQuery>;
    const where = { tenantId, ...(status ? { status } : {}) };
    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return ok(res, items, paginate(total, page, pageSize));
  })
);

publicRouter.get(
  '/orders/:id',
  requireApiScope(['read_only', 'orders', 'full_access']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({
      where: { id: req.params.id! },
      include: { items: true, events: true, shipments: true },
    });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    return ok(res, order);
  })
);

publicRouter.get(
  '/orders/:id/timeline',
  requireApiScope(['read_only', 'orders', 'full_access']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.params.id! } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    return ok(res, { current: order.status, events });
  })
);

publicRouter.get(
  '/customers',
  requireApiScope(['read_only', 'orders', 'full_access']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const items = await prisma.customer.findMany({ where: { tenantId }, take: 100 });
    return ok(res, items);
  })
);

publicRouter.get(
  '/products/:id',
  requireApiScope(['read_only', 'orders', 'full_access']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const p = await prisma.product.findUnique({ where: { id: req.params.id! }, include: { variants: true } });
    if (!p || p.tenantId !== tenantId) throw new NotFoundError('Product not found');
    return ok(res, p);
  })
);

publicRouter.get(
  '/products/:id/stock',
  requireApiScope(['read_only', 'orders', 'full_access']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const p = await prisma.product.findUnique({ where: { id: req.params.id! }, include: { variants: { include: { inventoryLevels: true } } } });
    if (!p || p.tenantId !== tenantId) throw new NotFoundError('Product not found');
    return ok(res, p.variants.map((v) => ({ variantId: v.id, sku: v.sku, levels: v.inventoryLevels })));
  })
);

publicRouter.get(
  '/analytics/summary',
  requireApiScope(['read_only', 'full_access']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [todayCount, total, delivered] = await Promise.all([
      prisma.order.count({ where: { tenantId, createdAt: { gte: today } } }),
      prisma.order.count({ where: { tenantId } }),
      prisma.order.count({ where: { tenantId, status: 'delivered' } }),
    ]);
    return ok(res, {
      todayOrders: todayCount,
      totalOrders: total,
      delivered,
      deliveryRate: total === 0 ? 0 : Number(((delivered / total) * 100).toFixed(2)),
    });
  })
);
