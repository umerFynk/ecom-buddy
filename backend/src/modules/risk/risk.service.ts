import { prisma } from '@/db/prisma';
import {
  CustomRuleEvaluated,
  DefaultFactorWeights,
  RiskConfigSnapshot,
  RiskDecision,
  RiskFactorContribution,
  RiskInputCustomer,
  RiskInputOrder,
  RiskScoreBreakdown,
} from './risk.types';
import { Action, evaluateRule } from './risk.rules';

const DEFAULT_FACTOR_WEIGHTS: DefaultFactorWeights = {
  phone_invalid: 40,
  address_incomplete: 20,
  first_time_customer: 10,
  order_value_above_city_avg_2x: 15,
  night_order_2am_6am: 5,
};

const CITY_TIER_MODIFIER: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 10, 3: 20, 4: 40 };

/**
 * Customer history modifier from blueprint Part 12:
 *   90%+ delivery rate → -10 (trusted)
 *   70-90 → 0
 *   50-70 → +10
 *   20-50 → +25
 *   0-20  → +40
 *   no history → +15
 */
function customerHistoryScore(customer: RiskInputCustomer): { points: number; reason: string } {
  if (!customer.exists || customer.totalOrders === 0) {
    return { points: 15, reason: 'No customer history' };
  }
  const completed = customer.deliveredCount + customer.returnedCount;
  if (completed === 0) return { points: 15, reason: 'No completed orders yet' };
  const rate = (customer.deliveredCount / completed) * 100;
  if (rate >= 90) return { points: -10, reason: `Delivery rate ${rate.toFixed(1)}% (trusted)` };
  if (rate >= 70) return { points: 0, reason: `Delivery rate ${rate.toFixed(1)}%` };
  if (rate >= 50) return { points: 10, reason: `Delivery rate ${rate.toFixed(1)}% (moderate)` };
  if (rate >= 20) return { points: 25, reason: `Delivery rate ${rate.toFixed(1)}% (high risk)` };
  return { points: 40, reason: `Delivery rate ${rate.toFixed(1)}% (very high risk)` };
}

/**
 * Approximation of "order_value > city_avg × 2": we treat anything > 5000 PKR
 * as above-typical for tier 2-4 cities and > 8000 PKR for tier 1. Real city
 * averages get computed from delivered orders later (Phase 5 reports).
 */
function isAboveCityAvg(amount: number, tier: 1 | 2 | 3 | 4): boolean {
  const threshold = tier === 1 ? 8000 : 5000;
  return amount > threshold * 2;
}

function isNightOrder(d: Date): boolean {
  const hour = d.getHours();
  return hour >= 2 && hour < 6;
}

function isAddressIncomplete(addr1: string, addr2?: string | null): boolean {
  const total = (addr1 ?? '').trim() + ' ' + (addr2 ?? '').trim();
  return total.trim().length < 12;
}

function decisionFor(score: number, snap: RiskConfigSnapshot): RiskDecision {
  if (snap.mode === 'off') return 'auto_confirm';
  if (score >= snap.cancelThreshold) return 'auto_cancel';
  if (score >= snap.csThreshold) return 'cs_review';
  if (score >= snap.otpThreshold) return 'otp_required';
  return 'wa_confirm';
}

export async function loadRiskConfig(tenantId: string): Promise<RiskConfigSnapshot> {
  const cfg = await prisma.riskEngineConfig.findUnique({ where: { tenantId } });
  if (!cfg) {
    return {
      mode: 'manual',
      factorWeights: DEFAULT_FACTOR_WEIGHTS,
      otpThreshold: 70,
      csThreshold: 80,
      cancelThreshold: 95,
    };
  }
  const stored = (cfg.factorWeights as Partial<DefaultFactorWeights>) ?? {};
  return {
    mode: cfg.mode === 'off' ? 'off' : cfg.mode === 'ai_engine' ? 'ai_engine' : 'manual',
    factorWeights: { ...DEFAULT_FACTOR_WEIGHTS, ...stored },
    otpThreshold: cfg.otpThreshold,
    csThreshold: cfg.csThreshold,
    cancelThreshold: cfg.cancelThreshold,
  };
}

/** Pure scoring used by Manual mode. AI mode (Phase 2) calls a separate function. */
export function scoreManual(
  order: RiskInputOrder,
  customer: RiskInputCustomer,
  snap: RiskConfigSnapshot
): RiskScoreBreakdown {
  const factors: RiskFactorContribution[] = [];

  // 1. Phone valid?
  if (!order.phoneIsValid) {
    factors.push({ factor: 'phone_invalid', value: snap.factorWeights.phone_invalid, reason: 'Phone failed normalization' });
  }

  // 2. Address completeness
  if (isAddressIncomplete(order.addressLine1, order.addressLine2)) {
    factors.push({ factor: 'address_incomplete', value: snap.factorWeights.address_incomplete, reason: 'Address < 12 chars' });
  }

  // 3. First time customer
  if (!customer.exists || customer.totalOrders === 0) {
    factors.push({ factor: 'first_time_customer', value: snap.factorWeights.first_time_customer, reason: 'No prior orders for this phone' });
  }

  // 4. Order value above city average
  if (isAboveCityAvg(order.amount, order.cityTier)) {
    factors.push({ factor: 'order_value_above_city_avg_2x', value: snap.factorWeights.order_value_above_city_avg_2x, reason: `Amount ${order.amount} > 2x typical for tier-${order.cityTier}` });
  }

  // 5. Night order
  if (isNightOrder(order.createdAt)) {
    factors.push({ factor: 'night_order_2am_6am', value: snap.factorWeights.night_order_2am_6am, reason: `Placed at ${order.createdAt.toISOString()}` });
  }

  // 6. City tier
  const cityMod = CITY_TIER_MODIFIER[order.cityTier];
  if (cityMod !== 0) {
    factors.push({ factor: 'city_tier', value: cityMod, reason: `City tier ${order.cityTier} (${order.city})` });
  }

  // 7. Customer history
  const hist = customerHistoryScore(customer);
  if (hist.points !== 0) {
    factors.push({ factor: 'customer_history', value: hist.points, reason: hist.reason });
  }

  // 8. Hard overrides
  if (order.paymentStatus === 'prepaid') {
    return finalize(0, factors, snap, { factor: 'prepaid_override', value: 0, reason: 'Prepaid orders auto-confirm' });
  }
  if (order.isVip) {
    return finalize(0, factors, snap, { factor: 'vip_override', value: 0, reason: 'VIP customer auto-confirm' });
  }
  if (customer.blacklistLevel === 'blacklisted' || customer.blacklistLevel === 'global') {
    return finalize(100, factors, snap, { factor: 'blacklisted', value: 100, reason: `Blacklist level: ${customer.blacklistLevel}` });
  }

  const sum = factors.reduce((acc, f) => acc + f.value, 0);
  const final = Math.max(0, Math.min(100, sum));
  return {
    base: 0,
    factors,
    finalScore: final,
    cappedAt0: sum < 0,
    decision: decisionFor(final, snap),
    modeUsed: 'manual',
    thresholds: { otp: snap.otpThreshold, cs: snap.csThreshold, cancel: snap.cancelThreshold },
  };
}

function finalize(
  forced: number,
  factors: RiskFactorContribution[],
  snap: RiskConfigSnapshot,
  forcing: RiskFactorContribution
): RiskScoreBreakdown {
  return {
    base: 0,
    factors: [...factors, forcing],
    finalScore: forced,
    cappedAt0: false,
    forcedScore: forced,
    decision: decisionFor(forced, snap),
    modeUsed: 'manual',
    thresholds: { otp: snap.otpThreshold, cs: snap.csThreshold, cancel: snap.cancelThreshold },
  };
}

export async function applyCustomRules(
  tenantId: string,
  order: RiskInputOrder,
  customer: RiskInputCustomer,
  baseBreakdown: RiskScoreBreakdown
): Promise<{ breakdown: RiskScoreBreakdown; rulesApplied: CustomRuleEvaluated[]; flags: string[] }> {
  const rules = await prisma.riskCustomRule.findMany({
    where: { tenantId, isActive: true },
    orderBy: { priority: 'asc' },
  });

  const evaluated: CustomRuleEvaluated[] = [];
  const flags: string[] = [];
  let score = baseBreakdown.finalScore;
  let forced: number | undefined = baseBreakdown.forcedScore;
  const factors = [...baseBreakdown.factors];

  for (const rule of rules) {
    const triggered = evaluateRule(rule.conditions, order, customer);
    if (!triggered) {
      evaluated.push({ ruleId: rule.id, name: rule.name, triggered: false, pointsApplied: 0 });
      continue;
    }
    let points = 0;
    let setScore: number | undefined;
    const actions = (rule.actions as unknown as Action[]) ?? [];
    for (const a of actions) {
      if (a.type === 'add') {
        points += a.value;
        score += a.value;
        factors.push({ factor: `rule:${rule.name}`, value: a.value, reason: `Custom rule "${rule.name}"` });
      } else if (a.type === 'set') {
        setScore = a.value;
        forced = a.value;
        score = a.value;
        factors.push({ factor: `rule_set:${rule.name}`, value: a.value, reason: `Custom rule "${rule.name}" forced score` });
      } else if (a.type === 'flag') {
        flags.push(a.value);
      }
    }
    evaluated.push({ ruleId: rule.id, name: rule.name, triggered: true, pointsApplied: points, setScore });

    // Bump trigger counter — fire-and-forget.
    void prisma.riskCustomRule
      .update({ where: { id: rule.id }, data: { triggerCount: { increment: 1 }, lastRunAt: new Date() } })
      .catch(() => {});
  }

  const finalScore = forced !== undefined ? forced : Math.max(0, Math.min(100, score));
  const breakdown: RiskScoreBreakdown = {
    ...baseBreakdown,
    factors,
    finalScore,
    forcedScore: forced,
    decision: decisionFor(finalScore, {
      mode: baseBreakdown.modeUsed,
      factorWeights: DEFAULT_FACTOR_WEIGHTS,
      otpThreshold: baseBreakdown.thresholds.otp,
      csThreshold: baseBreakdown.thresholds.cs,
      cancelThreshold: baseBreakdown.thresholds.cancel,
    }),
  };

  return { breakdown, rulesApplied: evaluated, flags };
}

/**
 * Phase 1 stub for AI Engine mode. Phase 2 swaps this for a GPT-4o call
 * with a structured-output schema. For now we delegate to manual scoring
 * so the surface stays the same.
 */
export async function scoreAi(
  order: RiskInputOrder,
  customer: RiskInputCustomer,
  snap: RiskConfigSnapshot
): Promise<RiskScoreBreakdown> {
  const manual = scoreManual(order, customer, snap);
  return { ...manual, modeUsed: 'ai_engine' };
}

export async function scoreOrder(
  tenantId: string,
  order: RiskInputOrder,
  customer: RiskInputCustomer
): Promise<{ breakdown: RiskScoreBreakdown; flags: string[]; rulesApplied: CustomRuleEvaluated[] }> {
  const snap = await loadRiskConfig(tenantId);

  if (snap.mode === 'off') {
    return {
      breakdown: {
        base: 0,
        factors: [{ factor: 'mode_off', value: 0, reason: 'Confirmation engine disabled' }],
        finalScore: 0,
        cappedAt0: false,
        decision: 'auto_confirm',
        modeUsed: 'off',
        thresholds: { otp: snap.otpThreshold, cs: snap.csThreshold, cancel: snap.cancelThreshold },
      },
      flags: [],
      rulesApplied: [],
    };
  }

  const base = snap.mode === 'ai_engine' ? await scoreAi(order, customer, snap) : scoreManual(order, customer, snap);
  return applyCustomRules(tenantId, order, customer, base);
}
