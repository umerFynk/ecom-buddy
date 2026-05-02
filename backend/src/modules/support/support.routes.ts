import { Router } from 'express';
import { z } from 'zod';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireAdminAuth, requireAdminRole, requireResellerAuth, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import {
  appendAdminReply,
  appendResellerReply,
  claimTicket,
  createTicket,
  flagSlaBreaches,
  getResellerTicket,
  listAdminTickets,
  listResellerTickets,
  setTicketPriority,
  setTicketStatus,
} from './support.service';

// Reseller-side router
export const supportRouter = Router();
supportRouter.use(requireResellerAuth);

const CategoryEnum = z.enum(['order_issue', 'courier', 'inventory', 'billing', 'bug', 'feature', 'general']);
const PriorityEnum = z.enum(['low', 'normal', 'high', 'urgent']);
const TicketStatusEnum = z.enum(['open', 'in_progress', 'waiting_on_reseller', 'resolved', 'closed']);

const CreateSchema = z.object({
  subject: z.string().min(3).max(200),
  category: CategoryEnum,
  priority: PriorityEnum.optional(),
  orderId: z.string().optional(),
  message: z.string().min(3).max(4000),
  attachmentUrl: z.string().url().optional(),
});

supportRouter.post(
  '/',
  validate(CreateSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    if (req.auth?.type !== 'reseller') return;
    const t = await createTicket({
      tenantId,
      actorUserId: req.auth.userId,
      subject: req.body.subject,
      category: req.body.category,
      priority: req.body.priority,
      orderId: req.body.orderId,
      message: req.body.message,
      attachmentUrl: req.body.attachmentUrl,
    });
    return created(res, t);
  })
);

const ListQuery = z.object({ status: TicketStatusEnum.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
supportRouter.get(
  '/',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const items = await listResellerTickets(tenantIdOf(req), {
      status: (req.query.status as never) || undefined,
      limit: Number(req.query.limit),
    });
    return ok(res, items);
  })
);

supportRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const t = await getResellerTicket(tenantIdOf(req), req.params.id!);
    if (!t) throw new NotFoundError('Ticket not found');
    return ok(res, t);
  })
);

const ReplySchema = z.object({ content: z.string().min(1).max(4000), attachmentUrl: z.string().url().optional() });
supportRouter.post(
  '/:id/reply',
  validate(ReplySchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'reseller') return;
    const t = await appendResellerReply({
      tenantId: tenantIdOf(req),
      ticketId: req.params.id!,
      actorUserId: req.auth.userId,
      content: req.body.content,
      attachmentUrl: req.body.attachmentUrl,
    });
    return ok(res, t);
  })
);

// Admin-side router
export const adminSupportRouter = Router();
adminSupportRouter.use(requireAdminAuth, requireAdminRole(['super_admin', 'account_manager', 'cs_agent']));

const AdminListQuery = z.object({
  status: TicketStatusEnum.optional(),
  assignedToMe: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

adminSupportRouter.get(
  '/',
  validate(AdminListQuery, 'query'),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const items = await listAdminTickets({
      status: (req.query.status as never) || undefined,
      assignedToAdminId: req.query.assignedToMe ? req.auth.adminId : undefined,
      limit: Number(req.query.limit),
    });
    return ok(res, items);
  })
);

adminSupportRouter.post(
  '/:id/claim',
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const t = await claimTicket({ ticketId: req.params.id!, adminId: req.auth.adminId });
    return ok(res, t);
  })
);

const AdminReplySchema = z.object({
  content: z.string().min(1).max(4000),
  attachmentUrl: z.string().url().optional(),
  isInternalNote: z.boolean().default(false),
  setStatus: TicketStatusEnum.optional(),
});

adminSupportRouter.post(
  '/:id/reply',
  validate(AdminReplySchema),
  asyncHandler(async (req, res) => {
    if (req.auth?.type !== 'admin') return;
    const t = await appendAdminReply({
      ticketId: req.params.id!,
      adminId: req.auth.adminId,
      content: req.body.content,
      attachmentUrl: req.body.attachmentUrl,
      isInternalNote: req.body.isInternalNote,
      setStatus: req.body.setStatus,
    });
    return ok(res, t);
  })
);

adminSupportRouter.patch(
  '/:id/priority',
  validate(z.object({ priority: PriorityEnum })),
  asyncHandler(async (req, res) => {
    const t = await setTicketPriority(req.params.id!, req.body.priority);
    return ok(res, t);
  })
);

adminSupportRouter.patch(
  '/:id/status',
  validate(z.object({ status: TicketStatusEnum })),
  asyncHandler(async (req, res) => {
    const t = await setTicketStatus(req.params.id!, req.body.status);
    return ok(res, t);
  })
);

adminSupportRouter.post(
  '/sla-sweep',
  requireAdminRole(['super_admin']),
  asyncHandler(async (_req, res) => {
    const r = await flagSlaBreaches();
    return ok(res, r);
  })
);
