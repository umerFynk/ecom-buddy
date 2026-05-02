import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, paginate } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { markRead } from './notifications.service';

export const notificationsRouter = Router();
notificationsRouter.use(requireResellerAuth);

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  unreadOnly: z.coerce.boolean().default(false),
});

notificationsRouter.get(
  '/',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, pageSize, unreadOnly } = req.query as unknown as z.infer<typeof ListQuery>;
    const where = { tenantId, ...(unreadOnly ? { isRead: false } : {}) };
    const [total, items] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return ok(res, items, paginate(total, page, pageSize));
  })
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await markRead(tenantIdOf(req), req.params.id!);
    return ok(res, { read: true });
  })
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const r = await prisma.notification.updateMany({
      where: { tenantId: tenantIdOf(req), isRead: false },
      data: { isRead: true },
    });
    return ok(res, { count: r.count });
  })
);

const SettingSchema = z.object({
  eventType: z.string().min(1).max(100),
  isEnabled: z.boolean().optional(),
  channelWa: z.boolean().optional(),
  channelEmail: z.boolean().optional(),
  channelInapp: z.boolean().optional(),
  quietHoursStart: z.string().nullable().optional(),
  quietHoursEnd: z.string().nullable().optional(),
});

notificationsRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const items = await prisma.notificationSetting.findMany({ where: { tenantId: tenantIdOf(req) } });
    return ok(res, items);
  })
);

notificationsRouter.put(
  '/settings',
  requireResellerRole(['owner', 'manager']),
  validate(SettingSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const body = req.body as z.infer<typeof SettingSchema>;
    const updated = await prisma.notificationSetting.upsert({
      where: { tenantId_eventType: { tenantId, eventType: body.eventType } },
      create: {
        tenantId,
        eventType: body.eventType,
        isEnabled: body.isEnabled ?? true,
        channelWa: body.channelWa ?? false,
        channelEmail: body.channelEmail ?? true,
        channelInapp: body.channelInapp ?? true,
        quietHoursStart: body.quietHoursStart ?? null,
        quietHoursEnd: body.quietHoursEnd ?? null,
      },
      update: {
        ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        ...(body.channelWa !== undefined ? { channelWa: body.channelWa } : {}),
        ...(body.channelEmail !== undefined ? { channelEmail: body.channelEmail } : {}),
        ...(body.channelInapp !== undefined ? { channelInapp: body.channelInapp } : {}),
        ...(body.quietHoursStart !== undefined ? { quietHoursStart: body.quietHoursStart } : {}),
        ...(body.quietHoursEnd !== undefined ? { quietHoursEnd: body.quietHoursEnd } : {}),
      },
    });
    return ok(res, updated);
  })
);
