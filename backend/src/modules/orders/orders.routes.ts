import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { ok, created, paginate } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { changeOrderStatus, listAllowedTransitionsFrom } from '../status/status.service';
import { normalizePakistaniPhone } from '@/lib/phoneNormalize';
import { normalizeCity } from '@/lib/cityNormalize';
import { scoreOrder } from '../risk/risk.service';

export const ordersRouter = Router();
ordersRouter.use(requireResellerAuth);

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  storeId: z.string().optional(),
  q: z.string().optional(), // phone | name | tracking | shopifyOrderNumber
  city: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

ordersRouter.get(
  '/',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, pageSize, status, storeId, q, city, dateFrom, dateTo } = req.query as unknown as z.infer<
      typeof ListQuery
    >;
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
      ...(storeId ? { storeId } : {}),
      ...(city ? { city } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { phone: { contains: q } },
              { customerName: { contains: q, mode: 'insensitive' } },
              { trackingNumber: { contains: q } },
              { shopifyOrderNumber: { contains: q } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: { items: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return ok(res, items, paginate(total, page, pageSize));
  })
);

ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id! },
      include: { items: true, events: { orderBy: { createdAt: 'asc' } }, shipments: true, customer: true },
    });
    if (!order || order.tenantId !== tenantIdOf(req)) throw new NotFoundError('Order not found');
    return ok(res, order);
  })
);

ordersRouter.get(
  '/:id/timeline',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id! } });
    if (!order || order.tenantId !== tenantIdOf(req)) throw new NotFoundError('Order not found');
    const events = await prisma.orderEvent.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    const allowedNext = await listAllowedTransitionsFrom(order.status);
    return ok(res, { current: order.status, events, allowedNext });
  })
);

const ManualOrderSchema = z.object({
  storeId: z.string(),
  customerName: z.string().min(1).max(120),
  phone: z.string().min(1),
  city: z.string().min(1),
  province: z.string().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  postalCode: z.string().optional(),
  amount: z.number().positive(),
  paymentStatus: z.enum(['cod', 'prepaid']).default('cod'),
  weightGrams: z.number().int().nonnegative().optional(),
  orderNote: z.string().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().optional(),
        title: z.string().min(1),
        sku: z.string().optional(),
        quantity: z.number().int().positive(),
        price: z.number().nonnegative(),
      })
    )
    .min(1),
});

ordersRouter.post(
  '/',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(ManualOrderSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const body = req.body as z.infer<typeof ManualOrderSchema>;
    const phoneRes = normalizePakistaniPhone(body.phone);
    const cityRes = await normalizeCity(body.city);

    const order = await prisma.$transaction(async (tx) => {
      let customerId: string | null = null;
      if (phoneRes.valid) {
        const customer = await tx.customer.upsert({
          where: { tenantId_phoneNormalized: { tenantId, phoneNormalized: phoneRes.normalized! } },
          create: {
            tenantId,
            phoneNormalized: phoneRes.normalized!,
            name: body.customerName,
            totalOrders: 1,
            lastOrderAt: new Date(),
          },
          update: {
            totalOrders: { increment: 1 },
            lastOrderAt: new Date(),
            name: body.customerName,
          },
        });
        customerId = customer.id;
      }

      const created = await tx.order.create({
        data: {
          tenantId,
          storeId: body.storeId,
          source: 'manual',
          status: 'new',
          customerId,
          customerName: body.customerName,
          phone: phoneRes.normalized ?? body.phone,
          city: cityRes.canonical || body.city,
          province: body.province ?? cityRes.province ?? null,
          addressLine1: body.addressLine1,
          addressLine2: body.addressLine2,
          postalCode: body.postalCode,
          amount: new Prisma.Decimal(body.amount),
          paymentStatus: body.paymentStatus,
          weightGrams: body.weightGrams,
          orderNote: body.orderNote,
          itemCount: body.items.reduce((acc, i) => acc + i.quantity, 0),
          codAmountExpected: body.paymentStatus === 'cod' ? new Prisma.Decimal(body.amount) : null,
          items: {
            create: body.items.map((i) => ({
              title: i.title,
              sku: i.sku,
              quantity: i.quantity,
              price: new Prisma.Decimal(i.price),
              variantId: i.variantId,
            })),
          },
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: created.id,
          fromStatus: null,
          toStatus: 'new',
          actorType: req.auth?.type === 'reseller' ? 'reseller_user' : 'system',
          actorId: req.auth?.type === 'reseller' ? req.auth.userId : undefined,
          note: 'Manual order created',
        },
      });

      return created;
    });

    return created(res, order);
  })
);

const ChangeStatusSchema = z.object({
  status: z.string().min(1),
  note: z.string().optional(),
  force: z.boolean().optional(),
});

ordersRouter.patch(
  '/:id/status',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(ChangeStatusSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.params.id! } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');

    // Only owners may use force.
    const force = req.body.force && req.auth?.type === 'reseller' && req.auth.role === 'owner';

    const updated = await changeOrderStatus({
      orderId: order.id,
      toStatus: req.body.status,
      actorType: req.auth?.type === 'reseller' ? 'reseller_user' : 'system',
      actorId: req.auth?.type === 'reseller' ? req.auth.userId : undefined,
      note: req.body.note,
      force,
    });
    return ok(res, updated);
  })
);

ordersRouter.post(
  '/:id/score',
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({
      where: { id: req.params.id! },
      include: { customer: true },
    });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');

    const cityRes = await normalizeCity(order.city);
    const phoneRes = normalizePakistaniPhone(order.phone);

    const result = await scoreOrder(
      tenantId,
      {
        amount: Number(order.amount),
        paymentStatus: order.paymentStatus,
        city: cityRes.canonical || order.city,
        cityTier: (cityRes.tier as 1 | 2 | 3 | 4) ?? 1,
        phone: order.phone,
        phoneIsValid: phoneRes.valid,
        addressLine1: order.addressLine1,
        addressLine2: order.addressLine2,
        createdAt: order.createdAt,
        customerTags: order.customer?.tags ?? [],
        isVip: order.customer?.isVip ?? false,
      },
      {
        exists: Boolean(order.customer),
        totalOrders: order.customer?.totalOrders ?? 0,
        deliveredCount: order.customer?.deliveredCount ?? 0,
        returnedCount: order.customer?.returnedCount ?? 0,
        blacklistLevel: (order.customer?.blacklistLevel ?? 'clean') as never,
      }
    );

    // Persist score + breakdown so the dashboard can render it.
    await prisma.order.update({
      where: { id: order.id },
      data: {
        riskScore: result.breakdown.finalScore,
        riskFlags: result.flags,
        riskBreakdown: result.breakdown as unknown as Prisma.InputJsonValue,
      },
    });

    return ok(res, result);
  })
);
