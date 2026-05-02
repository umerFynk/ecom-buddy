import { Router } from 'express';
import { CourierType } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { requireAdminAuth, requireAdminRole } from '@/middleware/auth';
import { recomputeSuccessRate7d } from '@/modules/couriers/assignment';

/**
 * Admin platform dashboard (BLUEPRINT.md Part 7 → Super Admin → Platform
 * Dashboard). Aggregates platform-wide KPIs that are not tenant-scoped.
 */

export const adminDashboardRouter = Router();
adminDashboardRouter.use(requireAdminAuth, requireAdminRole(['super_admin']));

adminDashboardRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const trialIn7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalResellers,
      activeResellers,
      byPlanRaw,
      todayOrders,
      monthOrders,
      monthDelivered,
      monthRto,
      mrrAggregate,
      trialEndingSoon,
      churnedThisMonth,
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.tenant.groupBy({ by: ['plan'], _count: { _all: true } }),
      prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.order.count({ where: { createdAt: { gte: monthStart }, status: { in: ['delivered', 'partially_delivered'] } } }),
      prisma.order.count({ where: { createdAt: { gte: monthStart }, status: { in: ['rto_initiated', 'rto_in_transit', 'rto_returned'] } } }),
      prisma.financial.aggregate({
        where: { recognizedAt: { gte: monthStart } },
        _sum: { revenue: true, netProfit: true },
      }),
      prisma.tenant.count({ where: { trialEndsAt: { gte: new Date(), lte: trialIn7Days }, isActive: true } }),
      prisma.tenant.count({ where: { isActive: false, updatedAt: { gte: monthStart } } }),
    ]);

    // Plan pricing from platform_config (falls back to seeded defaults).
    const plansCfg = await prisma.platformConfig.findUnique({ where: { key: 'plans' } });
    const planPrices: Record<string, { price_pkr: number }> = (plansCfg?.value as Record<string, { price_pkr: number }>) ?? {
      starter: { price_pkr: 0 },
      growth: { price_pkr: 9999 },
      scale: { price_pkr: 24999 },
    };
    const byPlan = Object.fromEntries(byPlanRaw.map((r) => [r.plan, r._count._all]));
    const mrrPkr = Object.entries(byPlan).reduce(
      (acc, [plan, count]) => acc + (planPrices[plan]?.price_pkr ?? 0) * (count as number),
      0
    );

    return ok(res, {
      resellers: { total: totalResellers, active: activeResellers, byPlan },
      orders: {
        today: todayOrders,
        month: monthOrders,
        monthDelivered,
        monthRto,
        monthDeliveryRatePct: monthOrders > 0 ? Number(((monthDelivered / monthOrders) * 100).toFixed(2)) : 0,
        monthRtoRatePct: monthOrders > 0 ? Number(((monthRto / monthOrders) * 100).toFixed(2)) : 0,
      },
      financials: {
        mrrPkr,
        arrPkr: mrrPkr * 12,
        recognizedRevenueMonthPkr: Math.round(Number(mrrAggregate._sum.revenue ?? 0)),
        netProfitMonthPkr: Math.round(Number(mrrAggregate._sum.netProfit ?? 0)),
      },
      growth: {
        trialEndingIn7Days: trialEndingSoon,
        churnedThisMonth,
      },
    });
  })
);

adminDashboardRouter.get(
  '/courier-health',
  asyncHandler(async (_req, res) => {
    const types: CourierType[] = ['postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier'];
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const out = await Promise.all(
      types.map(async (t) => {
        const [shipments, delivered, unmappedCount] = await Promise.all([
          prisma.shipment.count({ where: { courierConfig: { courierType: t }, bookedAt: { gte: since } } }),
          prisma.shipment.count({
            where: {
              courierConfig: { courierType: t },
              bookedAt: { gte: since },
              currentStatus: { in: ['delivered', 'partially_delivered'] },
            },
          }),
          prisma.courierStatusUnmapped.count({ where: { courierType: t, resolvedAt: null } }),
        ]);
        return {
          courier: t,
          shipments7d: shipments,
          delivered7d: delivered,
          deliveryRatePct: shipments > 0 ? Number(((delivered / shipments) * 100).toFixed(2)) : 0,
          openUnmappedStatuses: unmappedCount,
        };
      })
    );
    return ok(res, out);
  })
);

adminDashboardRouter.post(
  '/courier-health/recompute-all',
  asyncHandler(async (_req, res) => {
    const configs = await prisma.courierConfig.findMany({ where: { isActive: true } });
    let updated = 0;
    for (const c of configs) {
      try {
        await recomputeSuccessRate7d(c.id);
        updated++;
      } catch {
        /* swallow */
      }
    }
    return ok(res, { updated });
  })
);

adminDashboardRouter.get(
  '/oos-digest',
  asyncHandler(async (_req, res) => {
    const { buildAdminOosDigest } = await import('@/modules/inventory/inventory.oos');
    const rows = await buildAdminOosDigest();
    return ok(res, rows);
  })
);

adminDashboardRouter.get(
  '/pending-approvals',
  asyncHandler(async (_req, res) => {
    // Pending = inactive new signups that haven't been approved (Phase 1 default
    // is isActive=true; super admin can flip to false for review).
    const items = await prisma.tenant.findMany({
      where: { isActive: false },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return ok(res, items);
  })
);
