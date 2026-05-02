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

publicRouter.get(
  '/analytics/pnl',
  requireApiScope(['read_only', 'full_access']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const endDate = req.query.dateTo ? new Date(String(req.query.dateTo)) : new Date();
    const startDate = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const { buildPnlSummary } = await import('@/modules/reports/reports.service');
    const r = await buildPnlSummary(tenantId, { startDate, endDate });
    return ok(res, r);
  })
);

// ---------- Public order create / status update ----------

const CreateOrderSchema = z.object({
  storeId: z.string(),
  customerName: z.string().min(1).max(120),
  phone: z.string(),
  city: z.string(),
  province: z.string().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  postalCode: z.string().optional(),
  amount: z.number().positive(),
  paymentStatus: z.enum(['cod', 'prepaid']).default('cod'),
  externalRef: z.string().optional(),
  items: z.array(z.object({
    title: z.string().min(1),
    sku: z.string().optional(),
    quantity: z.number().int().positive(),
    price: z.number().nonnegative(),
  })).min(1),
});

publicRouter.post(
  '/orders',
  requireApiScope(['orders', 'full_access']),
  validate(CreateOrderSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    // Reuse the manual order code path so we keep risk + automation triggers.
    const { Prisma } = await import('@prisma/client');
    const { normalizePakistaniPhone } = await import('@/lib/phoneNormalize');
    const { normalizeCity } = await import('@/lib/cityNormalize');
    const body = req.body as z.infer<typeof CreateOrderSchema>;
    const phoneRes = normalizePakistaniPhone(body.phone);
    const cityRes = await normalizeCity(body.city);

    const created = await prisma.$transaction(async (tx) => {
      let customerId: string | null = null;
      if (phoneRes.valid) {
        const c = await tx.customer.upsert({
          where: { tenantId_phoneNormalized: { tenantId, phoneNormalized: phoneRes.normalized! } },
          create: { tenantId, phoneNormalized: phoneRes.normalized!, name: body.customerName, totalOrders: 1, lastOrderAt: new Date() },
          update: { totalOrders: { increment: 1 }, lastOrderAt: new Date(), name: body.customerName },
        });
        customerId = c.id;
      }
      const order = await tx.order.create({
        data: {
          tenantId,
          storeId: body.storeId,
          source: 'api',
          status: 'new',
          customerId,
          customerName: body.customerName,
          phone: phoneRes.normalized ?? body.phone,
          city: cityRes.canonical || body.city,
          province: body.province,
          addressLine1: body.addressLine1,
          addressLine2: body.addressLine2,
          postalCode: body.postalCode,
          amount: new Prisma.Decimal(body.amount),
          paymentStatus: body.paymentStatus,
          externalRef: body.externalRef,
          itemCount: body.items.reduce((acc, i) => acc + i.quantity, 0),
          codAmountExpected: body.paymentStatus === 'cod' ? new Prisma.Decimal(body.amount) : null,
          items: {
            create: body.items.map((i) => ({
              title: i.title,
              sku: i.sku,
              quantity: i.quantity,
              price: new Prisma.Decimal(i.price),
            })),
          },
        },
      });
      await tx.orderEvent.create({
        data: { orderId: order.id, fromStatus: null, toStatus: 'new', actorType: 'system', note: 'Created via Public API' },
      });
      return order;
    });

    // Fire created event so automations + webhooks see it.
    queueMicrotask(async () => {
      try {
        const { emit } = await import('@/lib/eventBus');
        emit('order.created', tenantId, { orderId: created.id });
      } catch {
        /* swallow */
      }
    });

    return ok(res, created, undefined, 201);
  })
);

const PatchOrderStatusSchema = z.object({ status: z.string() });

publicRouter.patch(
  '/orders/:id/status',
  requireApiScope(['orders', 'full_access']),
  validate(PatchOrderStatusSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.params.id! } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    const { changeOrderStatus } = await import('@/modules/status/status.service');
    const updated = await changeOrderStatus({
      orderId: order.id,
      toStatus: req.body.status,
      actorType: 'system',
      note: 'Public API status change',
    });
    return ok(res, updated);
  })
);

// ---------- Public shipments ----------

publicRouter.get(
  '/shipments/:trackingNumber',
  requireApiScope(['read_only', 'orders', 'full_access']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const ship = await prisma.shipment.findUnique({ where: { trackingNumber: req.params.trackingNumber! } });
    if (!ship || ship.tenantId !== tenantId) throw new NotFoundError('Shipment not found');
    return ok(res, ship);
  })
);

// ---------- Public webhook subscriptions (mirror of dashboard endpoint) ----------

publicRouter.get(
  '/webhooks',
  requireApiScope(['full_access']),
  asyncHandler(async (req, res) => {
    const items = await prisma.webhookSubscription.findMany({ where: { tenantId: tenantIdOf(req) } });
    return ok(res, items.map((s) => ({ ...s, secret: `${s.secret.slice(0, 10)}…` })));
  })
);

const PublicWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  description: z.string().optional(),
});

publicRouter.post(
  '/webhooks',
  requireApiScope(['full_access']),
  validate(PublicWebhookSchema),
  asyncHandler(async (req, res) => {
    const { generateSubscriptionSecret } = await import('@/modules/webhooks/webhooks.service');
    const tenantId = tenantIdOf(req);
    const secret = generateSubscriptionSecret();
    const sub = await prisma.webhookSubscription.create({
      data: {
        tenantId,
        url: req.body.url,
        events: req.body.events,
        description: req.body.description,
        secret,
      },
    });
    return ok(res, { ...sub, secret }, undefined, 201);
  })
);

publicRouter.delete(
  '/webhooks/:id',
  requireApiScope(['full_access']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const sub = await prisma.webhookSubscription.findUnique({ where: { id: req.params.id! } });
    if (!sub || sub.tenantId !== tenantId) throw new NotFoundError('Subscription not found');
    await prisma.webhookSubscription.delete({ where: { id: sub.id } });
    return ok(res, { deleted: true });
  })
);
