import { Router } from 'express';
import { z } from 'zod';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireAdminAuth, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { getConversation, listConversations, sendOutbound, setConversationStatus, takeOverFromAi } from './cs.service';
import { emitCsConversationUpdate, emitCsMessageNew } from './cs.socket';

export const csRouter = Router();
csRouter.use(requireResellerAuth);

const ListQuery = z.object({
  filter: z.enum(['all', 'unread', 'ai', 'cs', 'resolved']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

csRouter.get(
  '/conversations',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const items = await listConversations({
      tenantId: tenantIdOf(req),
      filter: req.query.filter as never,
      limit: Number(req.query.limit),
    });
    return ok(res, items);
  })
);

csRouter.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const conv = await getConversation({ conversationId: req.params.id!, tenantId: tenantIdOf(req) });
    if (!conv) throw new NotFoundError('Conversation not found');
    return ok(res, conv);
  })
);

const SendSchema = z.object({ text: z.string().min(1).max(4096) });

csRouter.post(
  '/conversations/:id/messages',
  validate(SendSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const msg = await sendOutbound({
      tenantId,
      conversationId: req.params.id!,
      text: req.body.text,
      sentByUserId: req.auth?.type === 'reseller' ? req.auth.userId : undefined,
      isAi: false,
    });
    emitCsMessageNew({ conversationId: req.params.id!, tenantId, message: msg });
    return ok(res, msg);
  })
);

const StatusSchema = z.object({
  status: z.enum(['open', 'ai_handling', 'cs_handling', 'resolved']),
});

csRouter.patch(
  '/conversations/:id/status',
  validate(StatusSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const updated = await setConversationStatus({ conversationId: req.params.id!, status: req.body.status });
    emitCsConversationUpdate({ conversationId: req.params.id!, tenantId, status: updated.status, isAiHandling: updated.isAiHandling });
    return ok(res, updated);
  })
);

// Admin-side router (cross-tenant CS view + admin take-over)
export const adminCsRouter = Router();
adminCsRouter.use(requireAdminAuth);

adminCsRouter.get(
  '/conversations',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const items = await listConversations({
      filter: req.query.filter as never,
      limit: Number(req.query.limit),
      assigneeAdminId: req.auth?.type === 'admin' ? req.auth.adminId : undefined,
    });
    return ok(res, items);
  })
);

adminCsRouter.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const conv = await getConversation({ conversationId: req.params.id! });
    if (!conv) throw new NotFoundError('Conversation not found');
    return ok(res, conv);
  })
);

adminCsRouter.post(
  '/conversations/:id/take-over',
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const updated = await takeOverFromAi({ conversationId: req.params.id!, adminId: req.auth.adminId });
    emitCsConversationUpdate({
      conversationId: updated.id,
      tenantId: updated.tenantId,
      status: updated.status,
      isAiHandling: updated.isAiHandling,
      assignedToAdminId: updated.assignedToAdminId,
    });
    return ok(res, updated);
  })
);

adminCsRouter.post(
  '/conversations/:id/messages',
  validate(SendSchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const conv = await getConversation({ conversationId: req.params.id! });
    if (!conv) throw new NotFoundError('Conversation not found');
    const msg = await sendOutbound({
      tenantId: conv.tenantId,
      conversationId: conv.id,
      text: req.body.text,
      sentByUserId: undefined,
      isAi: false,
    });
    emitCsMessageNew({ conversationId: conv.id, tenantId: conv.tenantId, message: msg });
    return ok(res, msg);
  })
);
