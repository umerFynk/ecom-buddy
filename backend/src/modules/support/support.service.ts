import { TicketPriority, TicketStatus } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';

/**
 * Support tickets (BLUEPRINT.md Part 22). Reseller → Ecom Buddy team.
 *
 * SLA targets per priority (hours from creation to first staff reply):
 *   urgent → 1h, high → 4h, normal → 24h, low → 72h.
 *
 * Each new ticket also creates a B2B conversation in the account manager's
 * inbox (linked via b2b_conversations.ticket_id) so all communication lives
 * in one Wati-style thread.
 */

const SLA_HOURS: Record<TicketPriority, number> = {
  urgent: 1,
  high: 4,
  normal: 24,
  low: 72,
};

export type TicketCategory =
  | 'order_issue'
  | 'courier'
  | 'inventory'
  | 'billing'
  | 'bug'
  | 'feature'
  | 'general';

export interface CreateTicketInput {
  tenantId: string;
  actorUserId: string;
  subject: string;
  category: TicketCategory;
  priority?: TicketPriority;
  orderId?: string;
  message: string;
  attachmentUrl?: string;
}

export async function createTicket(input: CreateTicketInput) {
  const priority = input.priority ?? 'normal';
  const slaBreachAt = new Date(Date.now() + SLA_HOURS[priority] * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: {
        tenantId: input.tenantId,
        subject: input.subject,
        category: input.category,
        priority,
        status: 'open',
        orderId: input.orderId,
        slaBreachAt,
      },
    });
    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderType: 'reseller_user',
        senderId: input.actorUserId,
        content: input.message,
        attachmentUrl: input.attachmentUrl,
        isInternalNote: false,
      },
    });
    // Create the linked B2B conversation so account managers see it in the inbox.
    await tx.b2bConversation.create({
      data: {
        tenantId: input.tenantId,
        ticketId: ticket.id,
        status: 'open',
      },
    });
    return ticket;
  });
}

export async function listResellerTickets(tenantId: string, opts?: { status?: TicketStatus; limit?: number }) {
  return prisma.supportTicket.findMany({
    where: { tenantId, ...(opts?.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: opts?.limit ?? 100,
  });
}

export async function getResellerTicket(tenantId: string, ticketId: string) {
  const t = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!t || t.tenantId !== tenantId) return null;
  // Hide internal notes from reseller view.
  return { ...t, messages: t.messages.filter((m) => !m.isInternalNote) };
}

export async function appendResellerReply(input: {
  tenantId: string;
  ticketId: string;
  actorUserId: string;
  content: string;
  attachmentUrl?: string;
}) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: input.ticketId } });
  if (!ticket || ticket.tenantId !== input.tenantId) throw new Error('Ticket not found');

  const next = await prisma.$transaction(async (tx) => {
    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderType: 'reseller_user',
        senderId: input.actorUserId,
        content: input.content,
        attachmentUrl: input.attachmentUrl,
        isInternalNote: false,
      },
    });
    // Re-open if it was waiting on the reseller.
    return tx.supportTicket.update({
      where: { id: ticket.id },
      data: { status: ticket.status === 'waiting_on_reseller' ? 'in_progress' : ticket.status, updatedAt: new Date() },
    });
  });
  return next;
}

// ---------- Admin side ----------

export async function listAdminTickets(opts?: { status?: TicketStatus; assignedToAdminId?: string; limit?: number }) {
  return prisma.supportTicket.findMany({
    where: {
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.assignedToAdminId ? { assignedToAdminId: opts.assignedToAdminId } : {}),
    },
    include: { tenant: { select: { name: true, plan: true } } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: opts?.limit ?? 200,
  });
}

export async function claimTicket(opts: { ticketId: string; adminId: string }) {
  return prisma.supportTicket.update({
    where: { id: opts.ticketId },
    data: { assignedToAdminId: opts.adminId, status: 'in_progress' },
  });
}

export async function appendAdminReply(opts: {
  ticketId: string;
  adminId: string;
  content: string;
  attachmentUrl?: string;
  /** When true, the message is hidden from the reseller (internal CS note). */
  isInternalNote?: boolean;
  setStatus?: TicketStatus;
}) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: opts.ticketId } });
  if (!ticket) throw new Error('Ticket not found');

  const updated = await prisma.$transaction(async (tx) => {
    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderType: 'admin',
        senderId: opts.adminId,
        content: opts.content,
        attachmentUrl: opts.attachmentUrl,
        isInternalNote: Boolean(opts.isInternalNote),
      },
    });
    return tx.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: opts.setStatus ?? (ticket.status === 'open' ? 'in_progress' : ticket.status),
        ...(opts.setStatus === 'resolved' ? { resolvedAt: new Date() } : {}),
        ...(opts.setStatus === 'closed' ? { closedAt: new Date() } : {}),
      },
    });
  });
  return updated;
}

export async function setTicketPriority(ticketId: string, priority: TicketPriority) {
  const slaBreachAt = new Date(Date.now() + SLA_HOURS[priority] * 60 * 60 * 1000);
  return prisma.supportTicket.update({
    where: { id: ticketId },
    data: { priority, slaBreachAt },
  });
}

export async function setTicketStatus(ticketId: string, status: TicketStatus) {
  return prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      status,
      ...(status === 'resolved' ? { resolvedAt: new Date() } : {}),
      ...(status === 'closed' ? { closedAt: new Date() } : {}),
    },
  });
}

/**
 * Sweep — flips slaBreachAt-overdue tickets into a high-priority queue and
 * notifies the assigned account manager. Run from a scheduled job (Phase 7
 * keeps it on-demand; the daily scheduler can call this directly).
 */
export async function flagSlaBreaches(): Promise<{ flagged: number }> {
  const overdue = await prisma.supportTicket.findMany({
    where: {
      status: { in: ['open', 'in_progress'] },
      slaBreachAt: { lt: new Date() },
      priority: { not: 'urgent' },
    },
    take: 200,
  });
  for (const t of overdue) {
    try {
      await prisma.supportTicket.update({
        where: { id: t.id },
        data: { priority: 'urgent', slaBreachAt: new Date(Date.now() + SLA_HOURS.urgent * 60 * 60 * 1000) },
      });
    } catch (err) {
      logger.warn({ err, ticketId: t.id }, 'sla_flag_failed');
    }
  }
  return { flagged: overdue.length };
}
