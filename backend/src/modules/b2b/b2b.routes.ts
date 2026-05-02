import { Router } from 'express';
import { z } from 'zod';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireAdminAuth, requireAdminRole } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { broadcast, estimateBroadcastAudience, getConversation, listConversations, sendOutboundB2bMessage, appendInboundB2bMessage } from './b2b.service';

// Admin-side router (account managers + super admin)
export const b2bRouter = Router();
b2bRouter.use(requireAdminAuth, requireAdminRole(['super_admin', 'account_manager']));

const ListQuery = z.object({
  status: z.string().optional(),
  assignedToMe: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

b2bRouter.get(
  '/conversations',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const items = await listConversations({
      status: (req.query.status as string) || undefined,
      assignedToMe: req.query.assignedToMe ? req.auth.adminId : undefined,
      limit: Number(req.query.limit),
    } as never);
    return ok(res, items);
  })
);

b2bRouter.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const c = await getConversation(req.params.id!);
    if (!c) throw new NotFoundError('Conversation not found');
    return ok(res, c);
  })
);

const SendSchema = z.object({ content: z.string().min(1).max(4000), attachmentUrl: z.string().url().optional() });

b2bRouter.post(
  '/conversations/:id/messages',
  validate(SendSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const conv = await getConversation(req.params.id!);
    if (!conv) throw new NotFoundError('Conversation not found');
    const r = await sendOutboundB2bMessage({
      tenantId: conv.tenantId,
      conversationId: conv.id,
      senderType: 'admin',
      senderId: req.auth.adminId,
      content: req.body.content,
      attachmentUrl: req.body.attachmentUrl,
    });
    return created(res, r);
  })
);

const FilterSchema = z.object({
  plan: z.union([z.enum(['starter', 'growth', 'scale']), z.array(z.enum(['starter', 'growth', 'scale']))]).optional(),
  isActive: z.boolean().optional(),
  trialEndingWithinDays: z.number().int().min(1).max(60).optional(),
});

b2bRouter.post(
  '/broadcasts/estimate',
  validate(FilterSchema),
  asyncHandler(async (req, res) => {
    const r = await estimateBroadcastAudience(req.body);
    return ok(res, r);
  })
);

const BroadcastSchema = z.object({
  filter: FilterSchema,
  message: z.string().min(1).max(2000),
});

b2bRouter.post(
  '/broadcasts',
  requireAdminRole(['super_admin']),
  validate(BroadcastSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const r = await broadcast({
      sentByAdminId: req.auth.adminId,
      filter: req.body.filter,
      message: req.body.message,
    });
    return created(res, r);
  })
);

// Webhook receiver for inbound B2B WA replies — mounted under
// /v1/webhooks/wa-b2b. Same shape as the customer WA webhook payload.
import { Router as MakeRouter } from 'express';
export const b2bWebhookRouter = MakeRouter();

b2bWebhookRouter.post(
  '/inbound',
  asyncHandler(async (req, res) => {
    const body = req.body as {
      messages?: Array<{ id: string; from: string; text?: { body: string }; type: string }>;
    };
    for (const m of body.messages ?? []) {
      if (m.type !== 'text' || !m.text) continue;
      // Match the from-phone to a tenant via tenant.settings.b2b_phone.
      const localPhone = m.from.startsWith('92') ? '0' + m.from.slice(2) : m.from;
      const { prisma } = await import('@/db/prisma');
      const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
      const tenant = tenants.find((t) => {
        const s = (t.settings as { b2b_phone?: string }) ?? {};
        return s.b2b_phone === localPhone;
      });
      if (!tenant) continue;
      await appendInboundB2bMessage({ tenantId: tenant.id, content: m.text.body });
    }
    return ok(res, { received: true });
  })
);
