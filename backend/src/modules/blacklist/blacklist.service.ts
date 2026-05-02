import { BlacklistLevel, Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';

/**
 * Blacklist tiering rules (BLUEPRINT.md Part 13):
 *
 *   Level 0 clean        — default
 *   Level 1 watch        — 1 RTO with this tenant            → OTP required
 *   Level 2 high_risk    — 2 RTOs OR 1 other tenant flagged  → CS review
 *   Level 3 blacklisted  — 3+ RTOs OR 2 tenants flagged       → Auto-cancel (override allowed)
 *   Level 4 global       — 3+ different tenants flagged      → Auto-cancel everywhere (admin only)
 *
 * Expiry:
 *   Level 1 auto-expires 6 months no RTO.
 *   Level 2 auto-expires 12 months no RTO.
 *   Level 3+ are manual only.
 */

const LEVEL_RANK: Record<BlacklistLevel, number> = {
  clean: 0,
  watch: 1,
  high_risk: 2,
  blacklisted: 3,
  global: 4,
};

interface CustomerStats {
  customerId: string;
  totalRtoForTenant: number;
  flaggedTenants: Set<string>; // tenant ids that have ever flagged this customer
}

async function gatherStats(customerId: string, currentTenantId: string): Promise<CustomerStats> {
  // Total RTOs across all tenants (we count completed RTOs from order_events).
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new NotFoundError(`Customer ${customerId} not found`);

  // RTO count just for the current tenant
  const rtoForTenant = await prisma.order.count({
    where: { customerId, tenantId: currentTenantId, OR: [{ status: 'rto_returned' }, { status: 'rto_initiated' }] },
  });

  // Distinct tenants that have flagged this phone (via prior blacklist_log).
  const phoneCustomers = await prisma.customer.findMany({
    where: { phoneNormalized: customer.phoneNormalized },
    select: { id: true, tenantId: true },
  });
  const flaggedTenants = new Set<string>();
  for (const pc of phoneCustomers) {
    const exists = await prisma.blacklistLog.findFirst({
      where: { customerId: pc.id, level: { in: ['watch', 'high_risk', 'blacklisted', 'global'] } },
      select: { tenantId: true },
    });
    if (exists) flaggedTenants.add(exists.tenantId);
  }

  return { customerId, totalRtoForTenant: rtoForTenant, flaggedTenants };
}

function computeNextLevel(stats: CustomerStats, current: BlacklistLevel): BlacklistLevel {
  // Apply rules in order; pick the highest-tier match.
  let level: BlacklistLevel = current;
  if (stats.totalRtoForTenant >= 1) level = max(level, 'watch');
  if (stats.totalRtoForTenant >= 2 || stats.flaggedTenants.size >= 1) level = max(level, 'high_risk');
  if (stats.totalRtoForTenant >= 3 || stats.flaggedTenants.size >= 2) level = max(level, 'blacklisted');
  if (stats.flaggedTenants.size >= 3) level = max(level, 'global');
  return level;
}

function max(a: BlacklistLevel, b: BlacklistLevel): BlacklistLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * Called from changeOrderStatus side-effect after an RTO terminal status.
 * Escalates the customer's blacklist level if rules say so, and propagates
 * level=global across all tenant-local Customer rows for the same phone.
 */
export async function escalateAfterRto(orderId: string): Promise<{ from?: BlacklistLevel; to?: BlacklistLevel } | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
  if (!order || !order.customer) return null;
  const customer = order.customer;
  const stats = await gatherStats(customer.id, order.tenantId);
  const next = computeNextLevel(stats, customer.blacklistLevel);
  if (next === customer.blacklistLevel) return { from: customer.blacklistLevel, to: next };

  await prisma.customer.update({
    where: { id: customer.id },
    data: { blacklistLevel: next, returnedCount: { increment: 1 } },
  });

  await prisma.blacklistLog.create({
    data: {
      customerId: customer.id,
      tenantId: order.tenantId,
      level: next,
      reason: `Auto-escalated after RTO on order ${order.id}`,
      actorType: 'system',
    },
  });

  // Level 4 global → propagate to every tenant-local copy of this phone.
  if (next === 'global') {
    const peers = await prisma.customer.findMany({
      where: { phoneNormalized: customer.phoneNormalized, id: { not: customer.id } },
    });
    for (const p of peers) {
      if (p.blacklistLevel !== 'global') {
        await prisma.customer.update({ where: { id: p.id }, data: { blacklistLevel: 'global' } });
        await prisma.blacklistLog.create({
          data: {
            customerId: p.id,
            tenantId: p.tenantId,
            level: 'global',
            reason: `Auto-globalized via phone ${customer.phoneNormalized}`,
            actorType: 'system',
          },
        });
      }
    }
  }

  logger.info({ customerId: customer.id, from: customer.blacklistLevel, to: next }, 'blacklist_escalated');
  return { from: customer.blacklistLevel, to: next };
}

/**
 * Reseller manual escalation. Used from the dashboard for proactive flagging.
 * Cannot exceed level 3 (Level 4 global is admin-only).
 */
export async function manualEscalate(opts: {
  tenantId: string;
  customerId: string;
  level: BlacklistLevel;
  reason: string;
  actorId: string;
  actorType?: 'reseller_user' | 'admin';
}): Promise<{ level: BlacklistLevel }> {
  if (opts.level === 'global' && opts.actorType !== 'admin') {
    throw new ForbiddenError('Only admins can apply Level 4 (global)');
  }
  const customer = await prisma.customer.findUnique({ where: { id: opts.customerId } });
  if (!customer || customer.tenantId !== opts.tenantId) throw new NotFoundError('Customer not found');

  await prisma.customer.update({ where: { id: customer.id }, data: { blacklistLevel: opts.level } });
  await prisma.blacklistLog.create({
    data: {
      customerId: customer.id,
      tenantId: opts.tenantId,
      level: opts.level,
      reason: opts.reason,
      actorId: opts.actorId,
      actorType: opts.actorType ?? 'reseller_user',
    },
  });

  if (opts.level === 'global') {
    const peers = await prisma.customer.findMany({
      where: { phoneNormalized: customer.phoneNormalized, id: { not: customer.id } },
    });
    for (const p of peers) {
      await prisma.customer.update({ where: { id: p.id }, data: { blacklistLevel: 'global' } });
    }
  }
  return { level: opts.level };
}

/**
 * Reseller override on a Level 3 blacklisted customer. Logs to
 * blacklist_overrides + reverts the order out of cancelled to confirmed.
 * If the order subsequently RTOs we promote the customer to Level 4 global.
 */
export async function overrideBlacklistedForOrder(opts: {
  tenantId: string;
  orderId: string;
  reason: string;
  actorId: string;
  acknowledged: boolean;
}): Promise<{ orderId: string }> {
  if (!opts.acknowledged) throw new ForbiddenError('Risk acknowledgement required');
  const order = await prisma.order.findUnique({
    where: { id: opts.orderId },
    include: { customer: true },
  });
  if (!order || order.tenantId !== opts.tenantId) throw new NotFoundError('Order not found');
  if (!order.customer) throw new ConflictError('Order has no linked customer');
  if (LEVEL_RANK[order.customer.blacklistLevel] < LEVEL_RANK.blacklisted) {
    throw new ConflictError('Customer is not blacklisted; override not required');
  }
  if (order.customer.blacklistLevel === 'global') {
    throw new ForbiddenError('Cannot override globally blacklisted customers — submit an appeal instead');
  }

  await prisma.blacklistOverride.create({
    data: {
      customerId: order.customer.id,
      tenantId: order.tenantId,
      orderId: order.id,
      reason: opts.reason,
      actorId: opts.actorId,
      outcome: 'pending',
    },
  });

  return { orderId: order.id };
}

/**
 * After an overridden order resolves (delivered or rto_returned), update the
 * matching blacklist_overrides row's outcome. Wired from changeOrderStatus.
 */
export async function recordOverrideOutcome(orderId: string, outcome: 'delivered' | 'rto'): Promise<void> {
  const override = await prisma.blacklistOverride.findFirst({
    where: { orderId, outcome: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
  if (!override) return;
  await prisma.blacklistOverride.update({ where: { id: override.id }, data: { outcome } });

  if (outcome === 'rto') {
    // Override that turned into RTO escalates the customer to Level 4 global.
    await prisma.customer.update({
      where: { id: override.customerId },
      data: { blacklistLevel: 'global' },
    });
    await prisma.blacklistLog.create({
      data: {
        customerId: override.customerId,
        tenantId: override.tenantId,
        level: 'global',
        reason: `Override on order ${orderId} resulted in RTO — auto-globalized`,
        actorType: 'system',
      },
    });
  }
}

/**
 * Appeals (any reseller can appeal a customer; admin reviews).
 */
export async function submitAppeal(opts: {
  appellantTenantId: string;
  customerId: string;
  reason: string;
  evidenceUrl?: string;
}) {
  const customer = await prisma.customer.findUnique({ where: { id: opts.customerId } });
  if (!customer) throw new NotFoundError('Customer not found');
  return prisma.blacklistAppeal.create({
    data: {
      customerId: opts.customerId,
      appellantTenantId: opts.appellantTenantId,
      reason: opts.reason,
      evidenceUrl: opts.evidenceUrl,
      status: 'pending',
    },
  });
}

export async function decideAppeal(opts: {
  appealId: string;
  adminId: string;
  approve: boolean;
  decisionNote: string;
}) {
  const appeal = await prisma.blacklistAppeal.findUnique({ where: { id: opts.appealId } });
  if (!appeal) throw new NotFoundError('Appeal not found');
  await prisma.blacklistAppeal.update({
    where: { id: appeal.id },
    data: {
      status: opts.approve ? 'approved' : 'rejected',
      adminDecision: opts.decisionNote,
      adminId: opts.adminId,
      resolvedAt: new Date(),
    },
  });

  if (opts.approve) {
    // Drop the customer's blacklist level by one tier.
    const customer = await prisma.customer.findUnique({ where: { id: appeal.customerId } });
    if (customer) {
      const newLevel: BlacklistLevel =
        customer.blacklistLevel === 'global' ? 'blacklisted'
        : customer.blacklistLevel === 'blacklisted' ? 'high_risk'
        : customer.blacklistLevel === 'high_risk' ? 'watch'
        : 'clean';
      await prisma.customer.update({ where: { id: customer.id }, data: { blacklistLevel: newLevel } });
      await prisma.blacklistLog.create({
        data: {
          customerId: customer.id,
          tenantId: customer.tenantId,
          level: newLevel,
          reason: `Appeal approved by admin: ${opts.decisionNote}`,
          actorId: opts.adminId,
          actorType: 'admin',
        },
      });
    }
  }
}

/**
 * Periodic auto-expiry sweep. Run from a daily cron-style worker.
 * Level 1 → clean after 6 months no RTO. Level 2 → clean after 12 months.
 */
export async function expireOldBlacklists(): Promise<{ expired: number }> {
  const now = Date.now();
  const sixMonthsAgo = new Date(now - 6 * 30 * 24 * 60 * 60 * 1000);
  const twelveMonthsAgo = new Date(now - 12 * 30 * 24 * 60 * 60 * 1000);

  const candidates = await prisma.customer.findMany({
    where: {
      OR: [
        { blacklistLevel: 'watch', updatedAt: { lt: sixMonthsAgo } },
        { blacklistLevel: 'high_risk', updatedAt: { lt: twelveMonthsAgo } },
      ],
    },
    select: { id: true, tenantId: true, blacklistLevel: true, lastOrderAt: true },
  });

  let expired = 0;
  for (const c of candidates) {
    // Only expire if the customer has had no RTO recently.
    const recentRto = await prisma.order.findFirst({
      where: {
        customerId: c.id,
        OR: [{ status: 'rto_returned' }, { status: 'rto_initiated' }],
        rtoAt: { gte: c.blacklistLevel === 'watch' ? sixMonthsAgo : twelveMonthsAgo },
      },
    });
    if (recentRto) continue;
    await prisma.customer.update({ where: { id: c.id }, data: { blacklistLevel: 'clean' } });
    await prisma.blacklistLog.create({
      data: {
        customerId: c.id,
        tenantId: c.tenantId,
        level: 'clean',
        reason: `Auto-expired from ${c.blacklistLevel} after grace period`,
        actorType: 'system',
      },
    });
    expired++;
  }
  return { expired };
}
