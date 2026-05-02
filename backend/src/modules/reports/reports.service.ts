import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';

/**
 * Reports service powering the dashboard's Overview / Products / Customers /
 * Financify P&L / City breakdown sub-tabs.
 *
 * Date inputs are inclusive on both ends. All money is PKR.
 */

export interface DateRange { startDate: Date; endDate: Date }

export interface OverviewKpi {
  totalOrders: number;
  confirmedOrders: number;
  deliveredOrders: number;
  rtoOrders: number;
  cancelledOrders: number;
  grossRevenuePkr: number;
  netProfitPkr: number;
  rtoRatePct: number;
  deliveryRatePct: number;
  confirmationRatePct: number;
  avgOrderValuePkr: number;
}

export interface DailyPoint { date: string; orders: number; delivered: number; rto: number; revenue: number }

export interface OverviewReport {
  kpi: OverviewKpi;
  daily: DailyPoint[];
  insights: string[];
}

function dayKey(d: Date) { return d.toISOString().slice(0, 10); }

export async function buildOverview(tenantId: string, range: DateRange): Promise<OverviewReport> {
  const where: Prisma.OrderWhereInput = {
    tenantId,
    createdAt: { gte: range.startDate, lte: range.endDate },
  };

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      status: true,
      amount: true,
      createdAt: true,
      deliveredAt: true,
      paymentStatus: true,
    },
    take: 50_000,
  });

  const total = orders.length;
  const confirmed = orders.filter((o) => ['confirmed', 'auto_confirmed', 'inventory_allocated', 'courier_booked', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'partially_delivered'].includes(o.status)).length;
  const delivered = orders.filter((o) => ['delivered', 'partially_delivered'].includes(o.status)).length;
  const rto = orders.filter((o) => ['rto_initiated', 'rto_in_transit', 'rto_returned'].includes(o.status)).length;
  const cancelled = orders.filter((o) => o.status.startsWith('cancelled')).length;

  const grossRevenue = orders
    .filter((o) => ['delivered', 'partially_delivered'].includes(o.status))
    .reduce((acc, o) => acc + Number(o.amount), 0);

  const fin = await prisma.financial.aggregate({
    where: { tenantId, recognizedAt: { gte: range.startDate, lte: range.endDate } },
    _sum: { netProfit: true },
  });

  const avgOrderValue = total > 0 ? orders.reduce((acc, o) => acc + Number(o.amount), 0) / total : 0;

  // Daily series — 7 buckets ending at endDate.
  const daily: DailyPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(range.endDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const dayOrders = orders.filter((o) => dayKey(o.createdAt) === key);
    daily.push({
      date: key,
      orders: dayOrders.length,
      delivered: dayOrders.filter((o) => ['delivered', 'partially_delivered'].includes(o.status)).length,
      rto: dayOrders.filter((o) => ['rto_initiated', 'rto_in_transit', 'rto_returned'].includes(o.status)).length,
      revenue: dayOrders
        .filter((o) => ['delivered', 'partially_delivered'].includes(o.status))
        .reduce((acc, o) => acc + Number(o.amount), 0),
    });
  }

  const kpi: OverviewKpi = {
    totalOrders: total,
    confirmedOrders: confirmed,
    deliveredOrders: delivered,
    rtoOrders: rto,
    cancelledOrders: cancelled,
    grossRevenuePkr: Math.round(grossRevenue),
    netProfitPkr: Math.round(Number(fin._sum.netProfit ?? 0)),
    rtoRatePct: total > 0 ? Number(((rto / total) * 100).toFixed(2)) : 0,
    deliveryRatePct: total > 0 ? Number(((delivered / total) * 100).toFixed(2)) : 0,
    confirmationRatePct: total > 0 ? Number(((confirmed / total) * 100).toFixed(2)) : 0,
    avgOrderValuePkr: Math.round(avgOrderValue),
  };

  return { kpi, daily, insights: buildInsights(kpi, daily) };
}

function buildInsights(kpi: OverviewKpi, daily: DailyPoint[]): string[] {
  const insights: string[] = [];
  if (kpi.totalOrders === 0) {
    insights.push('No orders in this period yet.');
    return insights;
  }
  if (kpi.rtoRatePct > 25) insights.push(`RTO rate is high (${kpi.rtoRatePct}%). Consider tightening confirmation thresholds.`);
  if (kpi.rtoRatePct < 10 && kpi.totalOrders > 50) insights.push(`Excellent RTO rate (${kpi.rtoRatePct}%) — you're doing better than the platform median.`);
  if (kpi.confirmationRatePct < 70) insights.push(`Confirmation rate is low (${kpi.confirmationRatePct}%). Review your "Pending Confirmation" queue.`);
  if (kpi.deliveryRatePct >= 80) insights.push(`Delivery rate ${kpi.deliveryRatePct}% — strong fulfillment quality.`);

  // Trend over daily window
  if (daily.length >= 7) {
    const firstHalf = daily.slice(0, 3).reduce((acc, d) => acc + d.orders, 0);
    const lastHalf = daily.slice(-3).reduce((acc, d) => acc + d.orders, 0);
    if (lastHalf > 0 && firstHalf > 0) {
      const delta = ((lastHalf - firstHalf) / firstHalf) * 100;
      if (delta > 20) insights.push(`Order volume up ${delta.toFixed(0)}% in the last 3 days vs the prior 3.`);
      if (delta < -20) insights.push(`Order volume down ${Math.abs(delta).toFixed(0)}% in the last 3 days — investigate.`);
    }
  }
  return insights;
}

// ---------- Products ----------

export interface ProductRow {
  productId: string;
  title: string;
  unitsSold: number;
  revenuePkr: number;
  marginPkr: number;
  returnRatePct: number;
}

export async function buildProductsReport(tenantId: string, range: DateRange): Promise<ProductRow[]> {
  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        tenantId,
        createdAt: { gte: range.startDate, lte: range.endDate },
      },
    },
    include: { variant: { include: { product: true } }, order: { select: { status: true } } },
    take: 50_000,
  });

  const byProduct = new Map<string, ProductRow>();
  for (const it of items) {
    if (!it.variant?.product) continue;
    const p = it.variant.product;
    const row = byProduct.get(p.id) ?? {
      productId: p.id,
      title: p.title,
      unitsSold: 0,
      revenuePkr: 0,
      marginPkr: 0,
      returnRatePct: 0,
    };
    const isDelivered = ['delivered', 'partially_delivered'].includes(it.order.status);
    const isReturned = ['rto_returned', 'rto_initiated', 'rto_in_transit'].includes(it.order.status);
    if (isDelivered || isReturned) {
      row.unitsSold += it.quantity;
      const lineRev = it.quantity * Number(it.price);
      row.revenuePkr += isDelivered ? lineRev : 0;
      const cogs = it.cogs ? Number(it.cogs) * it.quantity : 0;
      row.marginPkr += isDelivered ? lineRev - cogs : 0;
    }
    byProduct.set(p.id, row);
  }

  // Compute return rates
  for (const row of byProduct.values()) {
    const all = items.filter((i) => i.variant?.product.id === row.productId);
    const delivered = all.filter((i) => ['delivered', 'partially_delivered'].includes(i.order.status)).length;
    const returned = all.filter((i) => ['rto_returned', 'rto_initiated', 'rto_in_transit'].includes(i.order.status)).length;
    const total = delivered + returned;
    row.returnRatePct = total > 0 ? Number(((returned / total) * 100).toFixed(2)) : 0;
    row.revenuePkr = Math.round(row.revenuePkr);
    row.marginPkr = Math.round(row.marginPkr);
  }

  return Array.from(byProduct.values()).sort((a, b) => b.revenuePkr - a.revenuePkr);
}

// ---------- Customers ----------

export interface CustomersReport {
  newCount: number;
  repeatCount: number;
  topCustomers: Array<{ id: string; name: string | null; phone: string; orders: number; revenuePkr: number; deliveryRatePct: number }>;
  segments: { excellent: number; good: number; risky: number };
}

export async function buildCustomersReport(tenantId: string, range: DateRange): Promise<CustomersReport> {
  const customers = await prisma.customer.findMany({
    where: { tenantId },
    take: 20_000,
  });

  let newCount = 0;
  let repeatCount = 0;
  const inRange: typeof customers = [];
  for (const c of customers) {
    if (c.lastOrderAt && c.lastOrderAt >= range.startDate && c.lastOrderAt <= range.endDate) inRange.push(c);
    if (c.totalOrders === 1) newCount++;
    if (c.totalOrders >= 2) repeatCount++;
  }

  // Top customers by revenue (sum of delivered orders)
  const topRaw = await prisma.order.groupBy({
    by: ['customerId'],
    where: {
      tenantId,
      customerId: { not: null },
      createdAt: { gte: range.startDate, lte: range.endDate },
      status: { in: ['delivered', 'partially_delivered'] },
    },
    _sum: { amount: true },
    _count: { _all: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: 25,
  });

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const topCustomers = topRaw
    .filter((t) => t.customerId !== null)
    .map((t) => {
      const c = customerById.get(t.customerId!);
      const completed = (c?.deliveredCount ?? 0) + (c?.returnedCount ?? 0);
      const rate = completed > 0 ? ((c?.deliveredCount ?? 0) / completed) * 100 : 0;
      return {
        id: t.customerId!,
        name: c?.name ?? null,
        phone: c?.phoneNormalized ?? '',
        orders: t._count._all,
        revenuePkr: Math.round(Number(t._sum.amount ?? 0)),
        deliveryRatePct: Number(rate.toFixed(2)),
      };
    });

  // Delivery-rate segments
  let excellent = 0, good = 0, risky = 0;
  for (const c of customers) {
    const completed = c.deliveredCount + c.returnedCount;
    if (completed === 0) continue;
    const rate = (c.deliveredCount / completed) * 100;
    if (rate >= 90) excellent++;
    else if (rate >= 70) good++;
    else risky++;
  }

  return {
    newCount,
    repeatCount,
    topCustomers,
    segments: { excellent, good, risky },
  };
}

// ---------- City breakdown ----------

export interface CityRow {
  city: string;
  orders: number;
  delivered: number;
  rto: number;
  rtoRatePct: number;
  revenuePkr: number;
  netProfitPkr: number;
}

export async function buildCityBreakdown(tenantId: string, range: DateRange): Promise<CityRow[]> {
  const orders = await prisma.order.findMany({
    where: { tenantId, createdAt: { gte: range.startDate, lte: range.endDate } },
    select: { city: true, status: true, amount: true, id: true },
    take: 50_000,
  });

  const fins = await prisma.financial.findMany({
    where: { tenantId, order: { createdAt: { gte: range.startDate, lte: range.endDate } } },
    select: { orderId: true, netProfit: true },
  });
  const finByOrder = new Map(fins.map((f) => [f.orderId, Number(f.netProfit)]));

  const byCity = new Map<string, CityRow>();
  for (const o of orders) {
    const city = o.city || 'Unknown';
    const row = byCity.get(city) ?? { city, orders: 0, delivered: 0, rto: 0, rtoRatePct: 0, revenuePkr: 0, netProfitPkr: 0 };
    row.orders++;
    if (['delivered', 'partially_delivered'].includes(o.status)) {
      row.delivered++;
      row.revenuePkr += Number(o.amount);
    }
    if (['rto_initiated', 'rto_in_transit', 'rto_returned'].includes(o.status)) row.rto++;
    row.netProfitPkr += finByOrder.get(o.id) ?? 0;
    byCity.set(city, row);
  }

  const out = Array.from(byCity.values());
  for (const row of out) {
    row.rtoRatePct = row.orders > 0 ? Number(((row.rto / row.orders) * 100).toFixed(2)) : 0;
    row.revenuePkr = Math.round(row.revenuePkr);
    row.netProfitPkr = Math.round(row.netProfitPkr);
  }
  return out.sort((a, b) => b.orders - a.orders);
}

// ---------- P&L summary ----------

export interface PnlSummary {
  range: { startDate: string; endDate: string };
  recognizedRevenue: number;
  cogs: number;
  courierFees: number;
  codFees: number;
  waCost: number;
  rtoLoss: number;
  returnShipping: number;
  netProfit: number;
  marginPct: number;
  orderCount: number;
}

export async function buildPnlSummary(tenantId: string, range: DateRange): Promise<PnlSummary> {
  const fins = await prisma.financial.aggregate({
    where: { tenantId, recognizedAt: { gte: range.startDate, lte: range.endDate } },
    _sum: {
      revenue: true,
      cogs: true,
      courierFee: true,
      codFee: true,
      waCost: true,
      rtoLoss: true,
      returnShipping: true,
      netProfit: true,
    },
    _count: { _all: true },
  });
  const rev = Number(fins._sum.revenue ?? 0);
  const net = Number(fins._sum.netProfit ?? 0);
  return {
    range: { startDate: range.startDate.toISOString(), endDate: range.endDate.toISOString() },
    recognizedRevenue: Math.round(rev),
    cogs: Math.round(Number(fins._sum.cogs ?? 0)),
    courierFees: Math.round(Number(fins._sum.courierFee ?? 0)),
    codFees: Math.round(Number(fins._sum.codFee ?? 0)),
    waCost: Math.round(Number(fins._sum.waCost ?? 0)),
    rtoLoss: Math.round(Number(fins._sum.rtoLoss ?? 0)),
    returnShipping: Math.round(Number(fins._sum.returnShipping ?? 0)),
    netProfit: Math.round(net),
    marginPct: rev > 0 ? Number(((net / rev) * 100).toFixed(2)) : 0,
    orderCount: fins._count._all,
  };
}
