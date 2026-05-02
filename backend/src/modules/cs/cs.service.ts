import { CsConversationStatus, WaDirection } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { sendTextMessage } from '../wa/wa.service';

/**
 * Find or create the open CS conversation for (tenant, phone). Each
 * tenant+phone has at most one non-resolved conversation at any time.
 */
export async function findOrCreateConversation(opts: {
  tenantId: string;
  phone: string;
  customerId?: string | null;
}) {
  const open = await prisma.csConversation.findFirst({
    where: { tenantId: opts.tenantId, phone: opts.phone, status: { not: 'resolved' } },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (open) return open;

  return prisma.csConversation.create({
    data: {
      tenantId: opts.tenantId,
      phone: opts.phone,
      customerId: opts.customerId ?? null,
      status: 'ai_handling',
      isAiHandling: true,
    },
  });
}

/**
 * Append an inbound message to the right conversation. Used by the WA inbound
 * webhook handler. Returns the conversation + message so callers can broadcast
 * over Socket.io.
 */
export async function appendInbound(opts: {
  tenantId: string;
  phone: string;
  text: string;
  customerId?: string | null;
}) {
  const conv = await findOrCreateConversation(opts);
  const msg = await prisma.csMessage.create({
    data: {
      conversationId: conv.id,
      direction: WaDirection.inbound,
      content: opts.text,
    },
  });
  await prisma.csConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
  });
  return { conversation: conv, message: msg };
}

/**
 * Outbound reply (from human CS or admin). Sends via WA and writes the message.
 */
export async function sendOutbound(opts: {
  tenantId: string;
  conversationId: string;
  text: string;
  sentByUserId?: string;
  isAi?: boolean;
}) {
  const conv = await prisma.csConversation.findUnique({ where: { id: opts.conversationId } });
  if (!conv) throw new Error('Conversation not found');
  if (conv.tenantId !== opts.tenantId) throw new Error('Tenant mismatch');

  const send = await sendTextMessage({ tenantId: conv.tenantId, phone: conv.phone, text: opts.text });

  const msg = await prisma.csMessage.create({
    data: {
      conversationId: conv.id,
      direction: WaDirection.outbound,
      content: opts.text,
      waMessageId: send.waMessageId,
      sentByUserId: opts.sentByUserId,
      isAi: Boolean(opts.isAi),
    },
  });
  await prisma.csConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), unreadCount: 0 },
  });
  return msg;
}

export async function setConversationStatus(opts: {
  conversationId: string;
  status: CsConversationStatus;
  assignedToAdminId?: string | null;
}) {
  return prisma.csConversation.update({
    where: { id: opts.conversationId },
    data: {
      status: opts.status,
      isAiHandling: opts.status === 'ai_handling',
      ...(opts.assignedToAdminId !== undefined ? { assignedToAdminId: opts.assignedToAdminId } : {}),
    },
  });
}

export async function takeOverFromAi(opts: { conversationId: string; adminId: string }) {
  return prisma.csConversation.update({
    where: { id: opts.conversationId },
    data: {
      isAiHandling: false,
      status: 'cs_handling',
      assignedToAdminId: opts.adminId,
    },
  });
}

export async function listConversations(opts: {
  tenantId?: string; // omit for admin (cross-tenant)
  filter?: 'all' | 'unread' | 'ai' | 'cs' | 'resolved' | 'assigned_to_me';
  assigneeAdminId?: string;
  limit?: number;
}) {
  const where: Record<string, unknown> = {};
  if (opts.tenantId) where.tenantId = opts.tenantId;
  switch (opts.filter) {
    case 'unread':       where.unreadCount = { gt: 0 }; break;
    case 'ai':           where.isAiHandling = true; where.status = { not: 'resolved' }; break;
    case 'cs':           where.isAiHandling = false; where.status = { not: 'resolved' }; break;
    case 'resolved':     where.status = 'resolved'; break;
    case 'assigned_to_me': where.assignedToAdminId = opts.assigneeAdminId; break;
    case 'all':
    default:             /* no filter */
  }
  return prisma.csConversation.findMany({
    where: where as never,
    orderBy: { lastMessageAt: 'desc' },
    take: opts.limit ?? 100,
    include: { customer: { select: { name: true, blacklistLevel: true } } },
  });
}

export async function getConversation(opts: { conversationId: string; tenantId?: string }) {
  const conv = await prisma.csConversation.findUnique({
    where: { id: opts.conversationId },
    include: {
      messages: { orderBy: { sentAt: 'asc' }, take: 200 },
      customer: { select: { id: true, name: true, phoneNormalized: true, blacklistLevel: true, totalOrders: true } },
    },
  });
  if (!conv) return null;
  if (opts.tenantId && conv.tenantId !== opts.tenantId) return null;
  // Mark as read when fetched.
  await prisma.csConversation.update({ where: { id: conv.id }, data: { unreadCount: 0 } });
  return conv;
}
