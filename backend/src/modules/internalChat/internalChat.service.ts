import { prisma } from '@/db/prisma';

/**
 * Internal team chat (BLUEPRINT.md Part 22). Two modes:
 *   - Channels (#cs-team, #urgent, etc) — broadcast within members
 *   - DMs                              — 1:1 between admin users
 *
 * Order/ticket tagging: messages can contain #ORD-<orderId> or #TKT-<ticketId>;
 * we extract the first match into tagged_order_id / tagged_ticket_id columns
 * and the readers attach an inline expansion when fetching.
 */

const ORDER_TAG_RE = /#ORD-([A-Za-z0-9]{6,32})/;
const TICKET_TAG_RE = /#TKT-([A-Za-z0-9]{6,32})/;

function extractTags(text: string): { orderId?: string; ticketId?: string } {
  const out: { orderId?: string; ticketId?: string } = {};
  const o = text.match(ORDER_TAG_RE);
  if (o) out.orderId = o[1];
  const t = text.match(TICKET_TAG_RE);
  if (t) out.ticketId = t[1];
  return out;
}

// ---------- Channels ----------

export async function createChannel(opts: { name: string; description?: string; createdById: string; isPrivate?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.internalChannel.create({
      data: {
        name: opts.name,
        description: opts.description,
        createdById: opts.createdById,
        isPrivate: Boolean(opts.isPrivate),
      },
    });
    await tx.internalChannelMember.create({
      data: { channelId: c.id, userId: opts.createdById },
    });
    return c;
  });
}

export async function listChannels(opts: { adminId: string }) {
  // Public + channels the admin is a member of.
  return prisma.internalChannel.findMany({
    where: {
      OR: [
        { isPrivate: false },
        { members: { some: { userId: opts.adminId } } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function joinChannel(opts: { channelId: string; adminId: string }) {
  return prisma.internalChannelMember.upsert({
    where: { channelId_userId: { channelId: opts.channelId, userId: opts.adminId } },
    create: { channelId: opts.channelId, userId: opts.adminId },
    update: {},
  });
}

export async function leaveChannel(opts: { channelId: string; adminId: string }) {
  return prisma.internalChannelMember.deleteMany({
    where: { channelId: opts.channelId, userId: opts.adminId },
  });
}

export async function postChannelMessage(opts: { channelId: string; senderId: string; content: string }) {
  const tags = extractTags(opts.content);
  const msg = await prisma.internalMessage.create({
    data: {
      channelId: opts.channelId,
      senderId: opts.senderId,
      content: opts.content,
      taggedOrderId: tags.orderId,
      taggedTicketId: tags.ticketId,
    },
  });
  return msg;
}

export async function listChannelMessages(opts: { channelId: string; limit?: number }) {
  const msgs = await prisma.internalMessage.findMany({
    where: { channelId: opts.channelId },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 100,
    include: { sender: { select: { id: true, name: true, email: true, role: true } } },
  });
  // Attach inline expansions (best-effort lookup; nulls when not found / cross-tenant).
  return Promise.all(msgs.map(async (m) => ({
    ...m,
    inline: await buildInline(m.taggedOrderId, m.taggedTicketId),
  })));
}

export async function pinMessage(messageId: string, pin: boolean) {
  return prisma.internalMessage.update({ where: { id: messageId }, data: { isPinned: pin } });
}

// ---------- DMs ----------

export async function listDmThreads(opts: { adminId: string }) {
  // Group by counterparty.
  const last = await prisma.internalDirectMessage.findMany({
    where: { OR: [{ senderId: opts.adminId }, { recipientId: opts.adminId }] },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      sender: { select: { id: true, name: true, email: true } },
      recipient: { select: { id: true, name: true, email: true } },
    },
  });
  const seen = new Set<string>();
  const threads: Array<{ peerId: string; peerName: string | null; lastMessage: string; lastAt: Date; unread: number }> = [];
  for (const m of last) {
    const peer = m.senderId === opts.adminId ? m.recipient : m.sender;
    if (seen.has(peer.id)) continue;
    seen.add(peer.id);
    const unread = await prisma.internalDirectMessage.count({
      where: { recipientId: opts.adminId, senderId: peer.id, readAt: null },
    });
    threads.push({ peerId: peer.id, peerName: peer.name ?? peer.email, lastMessage: m.content, lastAt: m.createdAt, unread });
  }
  return threads;
}

export async function sendDm(opts: { senderId: string; recipientId: string; content: string }) {
  const tags = extractTags(opts.content);
  return prisma.internalDirectMessage.create({
    data: {
      senderId: opts.senderId,
      recipientId: opts.recipientId,
      content: opts.content,
      taggedOrderId: tags.orderId,
    },
  });
}

export async function listDm(opts: { adminId: string; peerId: string; limit?: number }) {
  const msgs = await prisma.internalDirectMessage.findMany({
    where: {
      OR: [
        { senderId: opts.adminId, recipientId: opts.peerId },
        { senderId: opts.peerId, recipientId: opts.adminId },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 100,
  });
  // Mark inbound ones read.
  await prisma.internalDirectMessage.updateMany({
    where: { senderId: opts.peerId, recipientId: opts.adminId, readAt: null },
    data: { readAt: new Date() },
  });
  return Promise.all(msgs.map(async (m) => ({ ...m, inline: await buildInline(m.taggedOrderId, undefined) })));
}

// ---------- Inline expansions ----------

async function buildInline(orderId?: string | null, ticketId?: string | null) {
  const out: { order?: unknown; ticket?: unknown } = {};
  if (orderId) {
    const o = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, shopifyOrderNumber: true, status: true, customerName: true,
        amount: true, courierType: true, trackingNumber: true,
        tenant: { select: { id: true, name: true } },
      },
    });
    if (o) out.order = o;
  }
  if (ticketId) {
    const t = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true, subject: true, status: true, priority: true,
        tenant: { select: { id: true, name: true } },
      },
    });
    if (t) out.ticket = t;
  }
  return Object.keys(out).length === 0 ? null : out;
}
