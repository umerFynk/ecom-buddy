import { Plan, Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { env } from '@/config/env';
import { WaClient } from '../wa/wa.client';

/**
 * B2B inbox (BLUEPRINT.md Part 20 — WA System 2). Account managers chat
 * with the resellers themselves (not their customers). Tenant-scoped
 * conversations live in b2b_conversations; messages in b2b_messages.
 *
 * Sending uses the dedicated DIALOG360_B2B_API_KEY — never the customer
 * shared key.
 */

function b2bClient(): WaClient {
  return new WaClient(env.DIALOG360_B2B_API_KEY);
}

function toWaTo(phone: string): string {
  if (phone.startsWith('03') && phone.length === 11) return '92' + phone.slice(1);
  if (phone.startsWith('+92')) return phone.slice(1);
  return phone;
}

export async function findOrCreateConversation(opts: { tenantId: string; accountManagerId?: string; ticketId?: string | null }) {
  const open = await prisma.b2bConversation.findFirst({
    where: { tenantId: opts.tenantId, status: { not: 'resolved' } },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (open) return open;
  return prisma.b2bConversation.create({
    data: {
      tenantId: opts.tenantId,
      accountManagerId: opts.accountManagerId,
      ticketId: opts.ticketId ?? null,
      status: 'open',
    },
  });
}

/**
 * Send an outgoing B2B message from an account manager to the reseller's
 * billing contact. Persists to b2b_messages; best-effort WA send.
 */
export async function sendOutboundB2bMessage(opts: {
  tenantId: string;
  conversationId: string;
  senderType: 'admin';
  senderId: string;
  content: string;
  attachmentUrl?: string;
}) {
  const conv = await prisma.b2bConversation.findUnique({ where: { id: opts.conversationId }, include: { tenant: true } });
  if (!conv || conv.tenantId !== opts.tenantId) throw new Error('Conversation not found');

  // Find a phone to send to: reseller's tenant.email isn't a phone — pull
  // from settings.b2b_phone if set; otherwise we still log the message
  // without sending (in-portal-only delivery).
  const settings = (conv.tenant.settings as { b2b_phone?: string }) ?? {};
  const phone = settings.b2b_phone;

  let waMessageId: string | undefined;
  if (phone) {
    try {
      const r = await b2bClient().sendText({ to: toWaTo(phone), text: opts.content });
      waMessageId = r.waMessageId;
    } catch (err) {
      logger.warn({ err, tenantId: opts.tenantId }, 'b2b_wa_send_failed_storing_anyway');
    }
  }

  const msg = await prisma.b2bMessage.create({
    data: {
      conversationId: conv.id,
      senderType: opts.senderType,
      senderId: opts.senderId,
      content: opts.content,
      attachmentUrl: opts.attachmentUrl,
    },
  });
  await prisma.b2bConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date() },
  });
  return { message: msg, waMessageId };
}

/**
 * Inbound B2B reply from the reseller side (via 360dialog B2B webhook).
 */
export async function appendInboundB2bMessage(opts: {
  tenantId: string;
  content: string;
  resellerUserId?: string;
}) {
  const conv = await findOrCreateConversation({ tenantId: opts.tenantId });
  const msg = await prisma.b2bMessage.create({
    data: {
      conversationId: conv.id,
      senderType: 'reseller_user',
      senderId: opts.resellerUserId ?? 'unknown',
      content: opts.content,
    },
  });
  await prisma.b2bConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
  return { conversation: conv, message: msg };
}

export async function listConversations(opts: { accountManagerId?: string; status?: string; limit?: number }) {
  return prisma.b2bConversation.findMany({
    where: {
      ...(opts.accountManagerId ? { accountManagerId: opts.accountManagerId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
    include: { tenant: { select: { id: true, name: true, plan: true, email: true } } },
    orderBy: { lastMessageAt: 'desc' },
    take: opts.limit ?? 200,
  });
}

export async function getConversation(id: string) {
  return prisma.b2bConversation.findUnique({
    where: { id },
    include: {
      tenant: { select: { id: true, name: true, email: true, plan: true } },
      messages: { orderBy: { sentAt: 'asc' }, take: 200 },
      ticket: { select: { id: true, subject: true, status: true, priority: true } },
    },
  });
}

// ---------- Broadcasts ----------

export interface BroadcastFilter {
  plan?: Plan | Plan[];
  isActive?: boolean;
  trialEndingWithinDays?: number;
}

export async function estimateBroadcastAudience(filter: BroadcastFilter): Promise<{ count: number }> {
  const where = buildBroadcastWhere(filter);
  const count = await prisma.tenant.count({ where });
  return { count };
}

function buildBroadcastWhere(filter: BroadcastFilter): Prisma.TenantWhereInput {
  const where: Prisma.TenantWhereInput = {};
  if (filter.plan) {
    where.plan = Array.isArray(filter.plan) ? { in: filter.plan } : filter.plan;
  }
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.trialEndingWithinDays) {
    const cutoff = new Date(Date.now() + filter.trialEndingWithinDays * 24 * 60 * 60 * 1000);
    where.trialEndsAt = { lte: cutoff, gte: new Date() };
  }
  return where;
}

export async function broadcast(opts: {
  sentByAdminId: string;
  filter: BroadcastFilter;
  message: string;
}): Promise<{ broadcastId: string; sent: number }> {
  const where = buildBroadcastWhere(opts.filter);
  const tenants = await prisma.tenant.findMany({ where });

  let sent = 0;
  for (const t of tenants) {
    try {
      const conv = await findOrCreateConversation({ tenantId: t.id });
      await sendOutboundB2bMessage({
        tenantId: t.id,
        conversationId: conv.id,
        senderType: 'admin',
        senderId: opts.sentByAdminId,
        content: opts.message,
      });
      sent++;
    } catch (err) {
      logger.warn({ err, tenantId: t.id }, 'broadcast_per_tenant_failed');
    }
  }

  const record = await prisma.b2bBroadcast.create({
    data: {
      sentByAdminId: opts.sentByAdminId,
      audienceType: opts.filter.plan ? 'segment' : 'all',
      audienceFilter: opts.filter as unknown as Prisma.InputJsonValue,
      message: opts.message,
      sentCount: sent,
    },
  });
  return { broadcastId: record.id, sent };
}
