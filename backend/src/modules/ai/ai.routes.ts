import { Router } from 'express';
import { z } from 'zod';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { chat, getConversation, listConversations } from './ai.assistant';
import { aiSearch } from './ai.search';

export const aiRouter = Router();
aiRouter.use(requireResellerAuth);

const ChatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

aiRouter.post(
  '/chat',
  validate(ChatSchema),
  asyncHandler(async (req, res) => {
    const result = await chat({
      tenantId: tenantIdOf(req),
      userId: req.auth?.type === 'reseller' ? req.auth.userId : undefined,
      conversationId: req.body.conversationId,
      message: req.body.message,
    });
    return ok(res, result);
  })
);

aiRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const items = await listConversations(
      tenantIdOf(req),
      req.auth?.type === 'reseller' ? req.auth.userId : undefined
    );
    return ok(res, items);
  })
);

aiRouter.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const conv = await getConversation(tenantIdOf(req), req.params.id!);
    if (!conv) throw new NotFoundError('Conversation not found');
    return ok(res, conv);
  })
);

const SearchSchema = z.object({
  query: z.string().min(1).max(500),
  table: z.enum(['orders', 'customers', 'products', 'shipments']),
});

aiRouter.post(
  '/search',
  validate(SearchSchema),
  asyncHandler(async (req, res) => {
    const r = await aiSearch({
      tenantId: tenantIdOf(req),
      query: req.body.query,
      table: req.body.table,
    });
    return ok(res, r);
  })
);
