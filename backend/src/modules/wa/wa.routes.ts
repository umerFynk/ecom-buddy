import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, paginate } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { ingestInboundMessage } from './wa.service';
import { WaSystem } from '@prisma/client';
import { handleInboundCustomerReply } from '../confirmation/confirmation.service';

export const waRouter = Router();

waRouter.use(requireResellerAuth);

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  phone: z.string().optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
});

waRouter.get(
  '/messages',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, pageSize, phone, direction } = req.query as unknown as z.infer<typeof ListQuery>;
    const where = {
      tenantId,
      ...(phone ? { phone } : {}),
      ...(direction ? { direction } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.waMessage.count({ where }),
      prisma.waMessage.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return ok(res, items, paginate(total, page, pageSize));
  })
);

waRouter.get(
  '/templates',
  asyncHandler(async (req, res) => {
    const items = await prisma.waTemplate.findMany({ where: { tenantId: tenantIdOf(req) } });
    return ok(res, items);
  })
);

const TemplateSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(['marketing', 'utility', 'authentication']),
  language: z.string().default('en'),
  content: z.string().min(1),
  variablesSchema: z.record(z.any()).optional(),
});

waRouter.post(
  '/templates',
  requireResellerRole(['owner', 'manager']),
  validate(TemplateSchema),
  asyncHandler(async (req, res) => {
    const t = await prisma.waTemplate.create({
      data: { tenantId: tenantIdOf(req), ...req.body, metaStatus: 'pending' },
    });
    return ok(res, t, undefined, 201);
  })
);

// Webhook receiver — 360dialog hits this when messages arrive or change status.
// Mounted at /v1/webhooks/wa (see routes/index.ts).
export const waWebhookRouter = Router();

waWebhookRouter.post(
  '/inbound',
  asyncHandler(async (req, res) => {
    // 360dialog payload is Meta-compatible; here we accept a flexible shape.
    const body = req.body as {
      messages?: Array<{ id: string; from: string; text?: { body: string }; timestamp?: string; type: string }>;
      statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }>;
    };

    // Status updates (sent/delivered/read/failed)
    for (const s of body.statuses ?? []) {
      const existing = await prisma.waMessage.findUnique({ where: { waMessageId: s.id } });
      if (!existing) continue;
      const next = ['queued', 'sent', 'delivered', 'read', 'failed'].includes(s.status) ? s.status : 'sent';
      await prisma.waMessage.update({
        where: { id: existing.id },
        data: {
          status: next as never,
          ...(next === 'delivered' ? { deliveredAt: new Date(Number(s.timestamp) * 1000) } : {}),
          ...(next === 'read' ? { readAt: new Date(Number(s.timestamp) * 1000) } : {}),
        },
      });
    }

    // Inbound messages — persist + drop into CS inbox + AI/confirmation handler.
    for (const m of body.messages ?? []) {
      if (m.type !== 'text' || !m.text) continue;
      const ingested = await ingestInboundMessage({
        waMessageId: m.id,
        fromPhone: m.from,
        text: m.text.body,
        receivedAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        system: WaSystem.customer,
      });
      if (!ingested) continue;
      try {
        const { appendInbound } = await import('@/modules/cs/cs.service');
        const { emitCsMessageNew } = await import('@/modules/cs/cs.socket');
        const { handleAiCsReply } = await import('@/modules/cs/cs.ai');

        const append = await appendInbound({
          tenantId: ingested.tenantId,
          phone: ingested.phone,
          text: m.text.body,
        });
        emitCsMessageNew({
          conversationId: append.conversation.id,
          tenantId: ingested.tenantId,
          message: append.message,
        });
        await handleAiCsReply({
          tenantId: ingested.tenantId,
          phone: ingested.phone,
          conversationId: append.conversation.id,
          inboundText: m.text.body,
        }).catch(() => {});
      } catch {
        // Fallback to legacy confirmation handler if anything above fails.
        await handleInboundCustomerReply(ingested.tenantId, ingested.phone, m.text.body).catch(() => {});
      }
    }

    return ok(res, { received: true });
  })
);
