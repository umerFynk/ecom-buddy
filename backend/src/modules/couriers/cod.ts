import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { buildAdapterForConfig } from './factory';

/**
 * Fetch COD status for a single delivered order — uses the courier's COD
 * status endpoint where available (PostEx today; others rely on the
 * remittance reconciliation flow in Phase 5).
 */
export async function refreshCodStatus(orderId: string): Promise<{ updated: boolean; status?: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { shipments: true },
  });
  if (!order) return { updated: false };
  if (order.codRemittanceStatus === 'paid') return { updated: false, status: 'paid' };
  if (order.paymentStatus !== 'cod') return { updated: false };

  const shipment = order.shipments[0];
  if (!shipment) return { updated: false };

  const adapter = await buildAdapterForConfig(shipment.courierConfigId);
  if (!adapter.getCodStatus) return { updated: false };

  let res;
  try {
    res = await adapter.getCodStatus(shipment.trackingNumber);
  } catch (err) {
    logger.warn({ err, orderId, tracking: shipment.trackingNumber }, 'cod_fetch_failed');
    return { updated: false };
  }

  if (!res.paid) return { updated: false };

  await prisma.order.update({
    where: { id: order.id },
    data: {
      codRemittanceStatus: 'paid',
      codAmountReceived: res.amountPkr ? new Prisma.Decimal(res.amountPkr) : order.codAmountExpected,
      codPaidAt: res.paidAt ?? new Date(),
    },
  });

  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: order.status,
      actorType: 'courier_webhook',
      note: `COD remitted (${res.amountPkr ?? 'amount unknown'})`,
      metadata: { source: 'cod_fetch', tracking: shipment.trackingNumber },
    },
  });

  // Cash-basis revenue recognition fires here.
  queueMicrotask(async () => {
    try {
      const { upsertFinancialForOrder } = await import('@/modules/financify/financify.service');
      await upsertFinancialForOrder(order.id);
    } catch {
      /* swallow */
    }
  });

  return { updated: true, status: 'paid' };
}

/**
 * Batch refresh — runs every 4h. Picks delivered, COD-pending orders from
 * the last 30 days and refreshes each.
 */
export async function batchRefreshCod(opts: { sinceDays?: number; limit?: number } = {}): Promise<{ checked: number; markedPaid: number }> {
  const since = new Date(Date.now() - (opts.sinceDays ?? 30) * 24 * 60 * 60 * 1000);
  const orders = await prisma.order.findMany({
    where: {
      paymentStatus: 'cod',
      status: 'delivered',
      codRemittanceStatus: { in: ['pending', 'short', 'unknown'] },
      deliveredAt: { gte: since },
    },
    take: opts.limit ?? 500,
    select: { id: true },
  });

  let markedPaid = 0;
  for (const o of orders) {
    const r = await refreshCodStatus(o.id);
    if (r.status === 'paid') markedPaid++;
  }
  return { checked: orders.length, markedPaid };
}
