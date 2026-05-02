import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { AI_MODEL, getOpenAi } from './ai.client';
import { callFn, FUNCTIONS } from './ai.functions';
import { env } from '@/config/env';

/**
 * AI seller assistant. Tenant-scoped. Function-calling over GPT-4o.
 *
 * Security model (BLUEPRINT.md Part 21): EVERY DB query is wrapped with
 * `where tenant_id = '{tenantId}'` AT THE FUNCTION LAYER, not the prompt
 * layer. The model can pick which function to call but cannot influence
 * the tenant id — that is fixed at the call site from the JWT.
 *
 * Chat lifecycle:
 *   1. Client posts {conversationId?, message} to /v1/ai/chat.
 *   2. Server creates conversation if needed, persists user message.
 *   3. Server runs a function-call loop with GPT-4o (max 4 iterations).
 *   4. Final assistant message is persisted + returned.
 */

const MAX_TOOL_LOOPS = 4;

const SYSTEM_PROMPT = `You are the Ecom Buddy seller assistant — a concise, factual analyst for a Pakistani e-commerce reseller.
You always answer in the same language as the user (English, Roman Urdu, or Urdu).

Rules:
- Use the provided function tools to fetch data; never invent numbers.
- For "is order X delivered" type questions: call query_orders with the order id.
- For trends / KPIs: call query_analytics with metric=overview.
- For "how do I…" questions: call search_knowledge_base.
- Round currency to whole rupees; format numbers with a thousands separator.
- Keep replies under 120 words unless asked for detail.
- If you're unsure, say so plainly — never guess.`;

export interface ChatInput {
  tenantId: string;
  userId?: string;
  conversationId?: string;
  message: string;
}

export interface ChatResult {
  conversationId: string;
  reply: string;
  toolCalls: Array<{ name: string; args: unknown; result?: unknown; error?: string }>;
  fallback?: 'no_openai_key' | 'openai_error';
}

async function ensureConversation(tenantId: string, userId: string | undefined, conversationId?: string) {
  if (conversationId) {
    const conv = await prisma.aiConversation.findUnique({ where: { id: conversationId } });
    if (conv && conv.tenantId === tenantId) return conv;
  }
  return prisma.aiConversation.create({ data: { tenantId, userId } });
}

async function loadHistory(conversationId: string) {
  const msgs = await prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  return msgs.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));
}

export async function chat(input: ChatInput): Promise<ChatResult> {
  const conv = await ensureConversation(input.tenantId, input.userId, input.conversationId);

  // Persist the user turn first.
  await prisma.aiMessage.create({
    data: { conversationId: conv.id, role: 'user', content: input.message },
  });

  // Stub fallback when no OpenAI key is configured — give a helpful canned
  // answer so the dashboard surface still works in dev.
  if (env.OPENAI_API_KEY === 'stub-openai-api-key') {
    const fallback = `(AI assistant in dev fallback — no OpenAI key configured.) You asked: "${input.message.slice(0, 200)}"`;
    await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'assistant', content: fallback, tokensUsed: 0 } });
    return { conversationId: conv.id, reply: fallback, toolCalls: [], fallback: 'no_openai_key' };
  }

  const ai = getOpenAi();
  const history = await loadHistory(conv.id);

  const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: unknown }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
  ];

  const toolCalls: ChatResult['toolCalls'] = [];
  let totalTokens = 0;
  let finalReply = '';

  try {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const completion = await ai.chat.completions.create({
        model: AI_MODEL,
        temperature: 0.3,
        messages: messages as never,
        tools: FUNCTIONS,
        tool_choice: 'auto',
      });
      totalTokens += completion.usage?.total_tokens ?? 0;
      const choice = completion.choices[0];
      if (!choice) break;

      const tools = choice.message.tool_calls ?? [];
      if (tools.length === 0) {
        finalReply = choice.message.content ?? '';
        messages.push({ role: 'assistant', content: finalReply });
        break;
      }

      // Push the assistant turn (with tool_calls) before tool replies.
      messages.push({ role: 'assistant', content: choice.message.content ?? '', tool_calls: tools as unknown });

      for (const t of tools) {
        // OpenAI's tool union has a `function` member only on the function-call
        // variant; cast safely so we work across SDK versions.
        const fn = (t as unknown as { function?: { name?: string; arguments?: string } }).function;
        const name = fn?.name ?? '';
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fn?.arguments ?? '{}');
        } catch {
          args = {};
        }
        try {
          const result = await callFn(name, { tenantId: input.tenantId }, args);
          toolCalls.push({ name, args, result });
          messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: t.id });
        } catch (err) {
          const message = (err as Error).message ?? String(err);
          toolCalls.push({ name, args, error: message });
          messages.push({ role: 'tool', content: JSON.stringify({ error: message }), tool_call_id: t.id });
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'ai_assistant_openai_error');
    finalReply = `Sorry — the assistant ran into an error talking to the model. Please try again. (${(err as Error).message})`;
    await prisma.aiMessage.create({ data: { conversationId: conv.id, role: 'assistant', content: finalReply, tokensUsed: totalTokens } });
    return { conversationId: conv.id, reply: finalReply, toolCalls, fallback: 'openai_error' };
  }

  if (!finalReply) {
    finalReply = 'Sorry — I could not produce a useful answer. Please rephrase or ask something more specific.';
  }
  await prisma.aiMessage.create({
    data: {
      conversationId: conv.id,
      role: 'assistant',
      content: finalReply,
      tokensUsed: totalTokens,
      ...(toolCalls.length > 0
        ? { functionCalled: toolCalls.map((t) => t.name).join(','), functionResult: toolCalls as never }
        : {}),
    },
  });

  return { conversationId: conv.id, reply: finalReply, toolCalls };
}

export async function listConversations(tenantId: string, userId?: string, limit = 50) {
  return prisma.aiConversation.findMany({
    where: { tenantId, ...(userId ? { userId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
}

export async function getConversation(tenantId: string, conversationId: string) {
  const conv = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conv || conv.tenantId !== tenantId) return null;
  return conv;
}
