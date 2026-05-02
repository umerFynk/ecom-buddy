import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, created, paginate } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { generateSubscriptionSecret, listDeliveries, listSubscriptions } from './webhooks.service';

export const webhookSubscriptionsRouter = Router();
webhookSubscriptionsRouter.use(requireResellerAuth);

const SUPPORTED_EVENTS = [
  'order.created',
  'order.status_changed',
  'order.confirmed',
  'order.dispatched',
  'order.delivered',
  'order.rto_initiated',
  'order.cancelled',
  'shipment.status_changed',
  'inventory.low_stock',
  'inventory.oos',
] as const;

const CreateSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1),
  description: z.string().max(200).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

webhookSubscriptionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const subs = await listSubscriptions(tenantIdOf(req));
    // Don't echo the full secret on list — only show prefix.
    return ok(res, subs.map((s) => ({ ...s, secret: `${s.secret.slice(0, 10)}…` })));
  })
);

webhookSubscriptionsRouter.post(
  '/',
  requireResellerRole(['owner']),
  validate(CreateSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const secret = generateSubscriptionSecret();
    const sub = await prisma.webhookSubscription.create({
      data: {
        tenantId,
        url: req.body.url,
        events: req.body.events,
        description: req.body.description,
        headers: req.body.headers,
        secret,
      },
    });
    // Return full secret ONCE on create — owner must save it for HMAC verification.
    return created(res, { ...sub, secret });
  })
);

const UpdateSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1).optional(),
  description: z.string().max(200).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  isActive: z.boolean().optional(),
});

webhookSubscriptionsRouter.patch(
  '/:id',
  requireResellerRole(['owner']),
  validate(UpdateSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const sub = await prisma.webhookSubscription.findUnique({ where: { id: req.params.id! } });
    if (!sub || sub.tenantId !== tenantId) throw new NotFoundError('Subscription not found');
    const body = req.body as z.infer<typeof UpdateSchema>;
    const updated = await prisma.webhookSubscription.update({
      where: { id: sub.id },
      data: {
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.events !== undefined ? { events: body.events } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.headers !== undefined ? { headers: body.headers } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    return ok(res, { ...updated, secret: `${updated.secret.slice(0, 10)}…` });
  })
);

webhookSubscriptionsRouter.delete(
  '/:id',
  requireResellerRole(['owner']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const sub = await prisma.webhookSubscription.findUnique({ where: { id: req.params.id! } });
    if (!sub || sub.tenantId !== tenantId) throw new NotFoundError('Subscription not found');
    await prisma.webhookSubscription.delete({ where: { id: sub.id } });
    return ok(res, { deleted: true });
  })
);

const DeliveriesQuery = z.object({
  subscriptionId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

webhookSubscriptionsRouter.get(
  '/deliveries',
  validate(DeliveriesQuery, 'query'),
  asyncHandler(async (req, res) => {
    const items = await listDeliveries(
      tenantIdOf(req),
      (req.query.subscriptionId as string) || undefined,
      Number(req.query.limit)
    );
    return ok(res, items, paginate(items.length, 1, Number(req.query.limit)));
  })
);
