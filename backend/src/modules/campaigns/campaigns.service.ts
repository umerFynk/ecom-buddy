import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { getQueue, QUEUES } from '@/jobs/queue';
import type { WaSendJob } from '@/jobs/workers/wa.worker';
import type { TemplateKey } from '../wa/wa.templates';

/**
 * WA campaign engine. Audience filter is a JSON query stored on the campaign;
 * supported keys:
 *   city: string | string[]
 *   blacklistMaxLevel: 'clean' | 'watch' | ...
 *   minOrders: number
 *   maxOrders: number
 *   isVip: boolean
 *   lastOrderAfter: ISO date
 *   lastOrderBefore: ISO date
 *   tag: string                  (matches any of customer.tags[])
 */

export interface AudienceFilter {
  city?: string | string[];
  blacklistMaxLevel?: 'clean' | 'watch' | 'high_risk';
  minOrders?: number;
  maxOrders?: number;
  isVip?: boolean;
  lastOrderAfter?: string;
  lastOrderBefore?: string;
  tag?: string;
}

const BLACKLIST_RANK = { clean: 0, watch: 1, high_risk: 2, blacklisted: 3, global: 4 } as const;

function buildWhere(tenantId: string, filter: AudienceFilter): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = { tenantId };
  if (filter.city) {
    where.OR = (Array.isArray(filter.city) ? filter.city : [filter.city]).map((c) => ({ orders: { some: { city: c } } }));
  }
  if (filter.blacklistMaxLevel) {
    const max = BLACKLIST_RANK[filter.blacklistMaxLevel];
    const allowed = (Object.entries(BLACKLIST_RANK) as Array<[keyof typeof BLACKLIST_RANK, number]>)
      .filter(([, v]) => v <= max)
      .map(([k]) => k);
    where.blacklistLevel = { in: allowed as never };
  }
  if (filter.minOrders !== undefined || filter.maxOrders !== undefined) {
    where.totalOrders = {
      ...(filter.minOrders !== undefined ? { gte: filter.minOrders } : {}),
      ...(filter.maxOrders !== undefined ? { lte: filter.maxOrders } : {}),
    };
  }
  if (filter.isVip !== undefined) where.isVip = filter.isVip;
  if (filter.lastOrderAfter || filter.lastOrderBefore) {
    where.lastOrderAt = {
      ...(filter.lastOrderAfter ? { gte: new Date(filter.lastOrderAfter) } : {}),
      ...(filter.lastOrderBefore ? { lte: new Date(filter.lastOrderBefore) } : {}),
    };
  }
  if (filter.tag) where.tags = { has: filter.tag };
  return where;
}

export async function estimateAudience(tenantId: string, filter: AudienceFilter): Promise<{ count: number }> {
  const where = buildWhere(tenantId, filter);
  const count = await prisma.customer.count({ where });
  return { count };
}

export async function createCampaign(opts: {
  tenantId: string;
  name: string;
  audienceFilter: AudienceFilter;
  templateId?: string;
  scheduledAt?: Date;
}) {
  return prisma.campaign.create({
    data: {
      tenantId: opts.tenantId,
      name: opts.name,
      audienceFilter: opts.audienceFilter as unknown as Prisma.InputJsonValue,
      templateId: opts.templateId,
      scheduledAt: opts.scheduledAt,
      status: opts.scheduledAt ? 'scheduled' : 'draft',
    },
  });
}

/**
 * Materialize the audience into campaign_recipients rows + queue all sends.
 * Idempotent — calling twice on the same campaign is a no-op for already-
 * loaded recipients.
 */
export async function launchCampaign(opts: {
  tenantId: string;
  campaignId: string;
  template: TemplateKey;
  variableTemplate?: Record<string, string>; // values like "{customer_name}" picked from customer fields
}): Promise<{ scheduled: number }> {
  const campaign = await prisma.campaign.findUnique({ where: { id: opts.campaignId } });
  if (!campaign || campaign.tenantId !== opts.tenantId) throw new NotFoundError('Campaign not found');
  if (campaign.status === 'sent') throw new ConflictError('Campaign already sent');

  const filter = (campaign.audienceFilter as AudienceFilter) ?? {};
  const where = buildWhere(opts.tenantId, filter);
  const customers = await prisma.customer.findMany({ where, take: 50_000 });

  // Insert any missing recipient rows.
  const queue = getQueue<WaSendJob>(QUEUES.WA_SEND);
  let scheduled = 0;
  // Per-tenant rate limit: 300 messages/min ≈ one every 200ms. We translate
  // to a delay-per-recipient so the wa-send worker spreads them out.
  const PER_RECIPIENT_DELAY_MS = 200;
  const baseTime = (campaign.scheduledAt ?? new Date()).getTime();

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    if (!c) continue;
    if (!c.phoneNormalized) continue;

    const recipient = await prisma.campaignRecipient.upsert({
      where: { id: `${campaign.id}_${c.id}` }, // synthetic id to keep upsert idempotent
      create: {
        id: `${campaign.id}_${c.id}`,
        campaignId: campaign.id,
        customerId: c.id,
        phone: c.phoneNormalized,
        status: 'pending',
      },
      update: {},
    });
    if (recipient.status !== 'pending') continue;

    const variables: Record<string, string> = {
      customer_name: c.name ?? 'Friend',
      ...(opts.variableTemplate ?? {}),
    };

    const delay = Math.max(0, baseTime - Date.now()) + i * PER_RECIPIENT_DELAY_MS;

    await queue.add(
      'campaign',
      {
        tenantId: opts.tenantId,
        phone: c.phoneNormalized,
        respectBusinessHours: true,
        eventType: `campaign:${campaign.id}`,
        payload: { kind: 'template', template: opts.template, variables },
      },
      { delay, attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 200, removeOnFail: 100 }
    );
    scheduled++;
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: 'sending',
      sentAt: new Date(),
      sentCount: scheduled,
    },
  });

  return { scheduled };
}

export async function listCampaigns(tenantId: string) {
  return prisma.campaign.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function getCampaign(tenantId: string, id: string) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c || c.tenantId !== tenantId) return null;
  return c;
}
