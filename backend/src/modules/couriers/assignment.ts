import { CourierConfig } from '@prisma/client';
import { prisma } from '@/db/prisma';

/**
 * Pick courier candidates for an order, in preference order.
 *
 * Selection rules (BLUEPRINT.md Part 6 → Couriers → Assignment Rules):
 *   1. Filter to active configs for the tenant.
 *   2. If a courier_config has a city override (city_overrides_json[city] = priority),
 *      that priority wins for orders to that city.
 *   3. Otherwise sort by `priority` ascending (lower = higher priority).
 *   4. Drop configs whose 7-day success rate is below `minSuccessRate` (default 70%).
 *
 * Returns an ordered list — caller iterates and falls over on booking failure.
 */
export interface AssignmentInput {
  tenantId: string;
  city: string;
  /** Force a specific courier config (manual override). */
  preferredCourierConfigId?: string;
  minSuccessRate?: number;
}

export interface CandidateConfig {
  config: CourierConfig;
  effectivePriority: number;
  reason: string;
}

export async function rankCourierCandidates(input: AssignmentInput): Promise<CandidateConfig[]> {
  const minRate = input.minSuccessRate ?? 70;

  if (input.preferredCourierConfigId) {
    const cfg = await prisma.courierConfig.findUnique({ where: { id: input.preferredCourierConfigId } });
    if (cfg && cfg.tenantId === input.tenantId && cfg.isActive) {
      return [{ config: cfg, effectivePriority: 0, reason: 'manual_override' }];
    }
    return [];
  }

  const configs = await prisma.courierConfig.findMany({
    where: { tenantId: input.tenantId, isActive: true },
  });

  const ranked: CandidateConfig[] = [];
  const cityKey = input.city?.trim().toLowerCase() ?? '';

  for (const cfg of configs) {
    // Cull by 7-day success rate (null = no data yet, treat as fine).
    if (cfg.successRate7d !== null && Number(cfg.successRate7d) < minRate) continue;

    const overrides = (cfg.cityOverrides as Record<string, number>) ?? {};
    const overrideKey = Object.keys(overrides).find((k) => k.trim().toLowerCase() === cityKey);
    if (overrideKey) {
      ranked.push({ config: cfg, effectivePriority: overrides[overrideKey] ?? cfg.priority, reason: `city_override:${overrideKey}` });
    } else {
      ranked.push({ config: cfg, effectivePriority: cfg.priority, reason: 'default_priority' });
    }
  }

  ranked.sort((a, b) => a.effectivePriority - b.effectivePriority);
  return ranked;
}

/**
 * Recompute success rate for a courier_config from the last 7 days of
 * shipments. Called periodically and after each shipment terminal event.
 */
export async function recomputeSuccessRate7d(courierConfigId: string): Promise<number | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const shipments = await prisma.shipment.findMany({
    where: { courierConfigId, bookedAt: { gte: since } },
    select: { currentStatus: true },
  });
  if (shipments.length === 0) return null;
  const success = shipments.filter((s) => s.currentStatus === 'delivered' || s.currentStatus === 'partially_delivered').length;
  const rate = (success / shipments.length) * 100;
  await prisma.courierConfig.update({
    where: { id: courierConfigId },
    data: { successRate7d: rate },
  });
  return rate;
}
