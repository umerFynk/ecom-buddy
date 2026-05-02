import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { AI_MODEL, getOpenAi } from '../ai/ai.client';
import { sendOutbound, setConversationStatus } from './cs.service';
import { emitCsConversationUpdate, emitCsMessageNew } from './cs.socket';
import { handleInboundCustomerReply } from '../confirmation/confirmation.service';
import { parseReply } from '../confirmation/confirmation.replies';

/**
 * AI handler for inbound CS messages.
 *
 * Order of operations:
 *   1. If the conversation is NOT ai_handling → return (human is on it).
 *   2. Try the deterministic confirmation parser first (Y/N/OTP). If it
 *      matches a known intent and there's a pending order confirmation, let
 *      the existing confirmation engine resolve it (no AI tokens spent).
 *   3. Otherwise classify with GPT-4o into one of:
 *        confirmation_intent | order_question | complaint | other
 *      and either reply with retrieved order context (questions) or escalate
 *      (complaints / low confidence).
 */

const SYSTEM_PROMPT = `You are a polite, concise WhatsApp customer-support agent for a Pakistani e-commerce store.
Reply in the same language as the customer's last message (English, Roman Urdu, or Urdu script).

You may answer ONLY based on the order context provided. Never invent details.
If you do not have enough context to answer, escalate to a human agent.
Keep replies under 60 words. Use friendly tone but stay professional.

Return strict JSON matching the provided schema.`;

const RESPONSE_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['intent', 'reply', 'escalate', 'confidence'],
  properties: {
    intent: { type: 'string' as const, enum: ['confirmation', 'order_question', 'complaint', 'other'] },
    reply: { type: 'string' as const, maxLength: 600, description: 'Reply to send to the customer. Empty string if escalating.' },
    escalate: { type: 'boolean' as const, description: 'True if a human should take over.' },
    confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
  },
};

interface AiClassification {
  intent: 'confirmation' | 'order_question' | 'complaint' | 'other';
  reply: string;
  escalate: boolean;
  confidence: number;
}

async function buildOrderContext(tenantId: string, phone: string): Promise<string> {
  const orders = await prisma.order.findMany({
    where: { tenantId, phone },
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: { items: true, shipments: true },
  });
  if (orders.length === 0) return 'This customer has no orders on file.';
  return orders
    .map((o, idx) => {
      const ship = o.shipments[0];
      return [
        `Order #${idx + 1}: ${o.shopifyOrderNumber ?? o.id.slice(-8)} (${o.status})`,
        `  Amount: PKR ${o.amount}, City: ${o.city}, Created: ${o.createdAt.toISOString().slice(0, 10)}`,
        ship ? `  Tracking: ${ship.trackingNumber} (${ship.currentStatus})` : '  Not yet booked',
        `  Items: ${o.items.map((i) => `${i.quantity}x ${i.title}`).join(', ')}`,
      ].join('\n');
    })
    .join('\n\n');
}

export async function handleAiCsReply(opts: {
  tenantId: string;
  phone: string;
  conversationId: string;
  inboundText: string;
}): Promise<{ handled: boolean; via: 'confirmation_engine' | 'ai_reply' | 'escalated' | 'skipped' }> {
  const conv = await prisma.csConversation.findUnique({ where: { id: opts.conversationId } });
  if (!conv) return { handled: false, via: 'skipped' };
  if (!conv.isAiHandling) return { handled: false, via: 'skipped' };

  // 1. Deterministic confirmation reply pass — fast + free.
  const parsed = parseReply(opts.inboundText);
  if (parsed.intent !== 'unknown') {
    try {
      const result = await handleInboundCustomerReply(opts.tenantId, opts.phone, opts.inboundText);
      if (result?.resolved === 'confirmed' || result?.resolved === 'cancelled') {
        return { handled: true, via: 'confirmation_engine' };
      }
    } catch {
      /* fall through to AI */
    }
  }

  // 2. GPT-4o classification + reply.
  const orderContext = await buildOrderContext(opts.tenantId, opts.phone);
  const ai = getOpenAi();

  let parsedAi: AiClassification | null = null;
  try {
    const completion = await ai.chat.completions.create({
      model: AI_MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `Order context:\n${orderContext}` },
        { role: 'user', content: opts.inboundText },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'cs_reply', schema: RESPONSE_SCHEMA, strict: true },
      },
    });
    const content = completion.choices[0]?.message?.content;
    if (content) parsedAi = JSON.parse(content) as AiClassification;
  } catch (err) {
    logger.warn({ err }, 'cs_ai_classify_failed');
  }

  if (!parsedAi) {
    return await escalate(opts, 'AI classification failed');
  }

  // Always escalate complaints + low-confidence + explicit escalate flag.
  if (parsedAi.escalate || parsedAi.intent === 'complaint' || parsedAi.confidence < 0.5) {
    return await escalate(opts, parsedAi.reply || 'AI escalated');
  }

  if (parsedAi.reply.trim().length === 0) {
    return await escalate(opts, 'AI returned empty reply');
  }

  const msg = await sendOutbound({
    tenantId: opts.tenantId,
    conversationId: opts.conversationId,
    text: parsedAi.reply,
    isAi: true,
  });
  emitCsMessageNew({ conversationId: opts.conversationId, tenantId: opts.tenantId, message: msg });
  return { handled: true, via: 'ai_reply' };
}

async function escalate(
  opts: { tenantId: string; conversationId: string },
  reason: string
): Promise<{ handled: boolean; via: 'escalated' }> {
  const updated = await setConversationStatus({
    conversationId: opts.conversationId,
    status: 'cs_handling',
  });
  emitCsConversationUpdate({
    conversationId: opts.conversationId,
    tenantId: opts.tenantId,
    status: updated.status,
    isAiHandling: updated.isAiHandling,
  });
  logger.info({ conversationId: opts.conversationId, reason }, 'cs_ai_escalated_to_human');
  return { handled: true, via: 'escalated' };
}
