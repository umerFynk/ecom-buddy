import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { DEFAULT_COURIER_FEES, FinancialBreakdown, RecognitionMode } from './financify.types';

const TERMINAL_DELIVERED = ['delivered', 'partially_delivered'];
const TERMINAL_RTO = ['rto_returned'];
const ACTIVE_DISPATCHED = ['dispatched', 'in_transit', 'out_for_delivery', ...TERMINAL_DELIVERED];

/**
 * Per-tenant revenue recognition mode lives in tenant.settings.recognition_mode.
 * Default = cash_basis (per BLUEPRINT.md Part 19).
 */
async function recognitionModeFor(tenantId: string): Promise<RecognitionMode> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const settings = (tenant?.settings as { recognition_mode?: RecognitionMode }) ?? {};
  return settings.recognition_mode ?? 'cash_basis';
}

function shouldRecognize(mode: RecognitionMode, status: string, codPaid: boolean): boolean {
  if (mode === 'cash_basis') return codPaid; // recognize only when COD has been remitted
  if (mode === 'accrual_delivered') return TERMINAL_DELIVERED.includes(status);
  if (mode === 'accrual_dispatched') return ACTIVE_DISPATCHED.includes(status);
  return false;
}

function computeWaCostForOrder(messageCount: number): number {
  // 360dialog rough cost: ~PKR 2.5 per template message + 1 PKR per inbound.
  return Math.max(0, messageCount) * 2.5;
}

/**
 * Compute the full P&L breakdown for an order.
 */
export async function computeFinancialBreakdown(orderId: string): Promise<FinancialBreakdown | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, shipments: true },
  });
  if (!order) return null;

  const mode = await recognitionModeFor(order.tenantId);
  const notes: string[] = [];

  const grossRevenue = Number(order.amount) - Number(order.discount ?? 0);
  const cogs = order.items.reduce((acc, it) => acc + (it.cogs ? Number(it.cogs) * it.quantity : 0), 0);
  const grossProfit = grossRevenue - cogs;

  const courierTypeKey = (order.courierType ?? 'postex') as keyof typeof DEFAULT_COURIER_FEES;
  const fees = DEFAULT_COURIER_FEES[courierTypeKey] ?? DEFAULT_COURIER_FEES.postex!;
  const courierFee = order.shipments.length > 0 ? fees.bookingFeePkr : 0;
  const codFee = order.paymentStatus === 'cod' ? grossRevenue * (fees.codFeePct / 100) : 0;

  const messageCount = await prisma.waMessage.count({ where: { phone: order.phone, tenantId: order.tenantId } });
  const waCost = computeWaCostForOrder(messageCount);

  let rtoLoss = 0;
  let returnShipping = 0;
  if (TERMINAL_RTO.includes(order.status)) {
    rtoLoss = grossRevenue; // revenue reversed
    returnShipping = courierFee; // pay return leg too
    notes.push('RTO terminal — revenue reversed, return shipping booked');
  }

  const codPaid = order.codRemittanceStatus === 'paid';
  const recognized = shouldRecognize(mode, order.status, codPaid);
  const recognizedRevenue = recognized && rtoLoss === 0 ? grossRevenue : 0;
  if (!recognized) notes.push(`Revenue not yet recognized (mode=${mode}, status=${order.status}, codPaid=${codPaid})`);

  const netProfit = recognizedRevenue - cogs - courierFee - codFee - waCost - rtoLoss - returnShipping;
  const margin = recognizedRevenue > 0 ? (netProfit / recognizedRevenue) * 100 : 0;

  return {
    grossRevenue: recognizedRevenue,
    cogs,
    grossProfit: recognizedRevenue - cogs,
    courierFee,
    codFee,
    waCost,
    rtoLoss,
    returnShipping,
    netProfit,
    margin: Number(margin.toFixed(2)),
    recognitionMode: mode,
    ...(recognized ? { recognizedAt: new Date() } : {}),
    notes,
  };
}

/**
 * Persist the breakdown into the financials table (1:1 with Order).
 */
export async function upsertFinancialForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { tenantId: true } });
  if (!order) return;

  const breakdown = await computeFinancialBreakdown(orderId);
  if (!breakdown) return;

  await prisma.financial.upsert({
    where: { orderId },
    create: {
      tenantId: order.tenantId,
      orderId,
      revenue: new Prisma.Decimal(breakdown.grossRevenue),
      cogs: new Prisma.Decimal(breakdown.cogs),
      courierFee: new Prisma.Decimal(breakdown.courierFee),
      codFee: new Prisma.Decimal(breakdown.codFee),
      waCost: new Prisma.Decimal(breakdown.waCost),
      rtoLoss: new Prisma.Decimal(breakdown.rtoLoss),
      returnShipping: new Prisma.Decimal(breakdown.returnShipping),
      netProfit: new Prisma.Decimal(breakdown.netProfit),
      margin: new Prisma.Decimal(breakdown.margin),
      recognitionMode: breakdown.recognitionMode,
      ...(breakdown.recognizedAt ? { recognizedAt: breakdown.recognizedAt } : {}),
    },
    update: {
      revenue: new Prisma.Decimal(breakdown.grossRevenue),
      cogs: new Prisma.Decimal(breakdown.cogs),
      courierFee: new Prisma.Decimal(breakdown.courierFee),
      codFee: new Prisma.Decimal(breakdown.codFee),
      waCost: new Prisma.Decimal(breakdown.waCost),
      rtoLoss: new Prisma.Decimal(breakdown.rtoLoss),
      returnShipping: new Prisma.Decimal(breakdown.returnShipping),
      netProfit: new Prisma.Decimal(breakdown.netProfit),
      margin: new Prisma.Decimal(breakdown.margin),
      recognitionMode: breakdown.recognitionMode,
      ...(breakdown.recognizedAt ? { recognizedAt: breakdown.recognizedAt } : {}),
    },
  });
}

/**
 * Recompute financials in bulk for a tenant (used after recognition mode
 * changes, or on first activation). Limited to 5,000 orders per call.
 */
export async function recomputeTenantFinancials(tenantId: string): Promise<{ recomputed: number }> {
  const orders = await prisma.order.findMany({
    where: { tenantId },
    select: { id: true },
    take: 5000,
    orderBy: { createdAt: 'desc' },
  });
  for (const o of orders) {
    try {
      await upsertFinancialForOrder(o.id);
    } catch (err) {
      logger.warn({ err, orderId: o.id }, 'financial_upsert_failed');
    }
  }
  return { recomputed: orders.length };
}
