import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { buildAdapterForConfig } from './factory';
import { mapCourierStatus } from './statusMapping';
import { changeOrderStatus } from '../status/status.service';
import { recomputeSuccessRate7d } from './assignment';

const TERMINAL_STATUSES = new Set(['delivered', 'rto_returned', 'cancelled_by_seller', 'cancelled_no_response', 'cancelled_fake', 'cancelled_by_customer', 'cancelled_by_courier']);

/**
 * Poll a single shipment: fetch tracking from courier, map every new event,
 * apply the latest mapped status to the order, append to statusHistory.
 */
export async function pollShipment(shipmentId: string): Promise<{ updated: boolean; current?: string }> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { courierConfig: true, order: true },
  });
  if (!shipment) return { updated: false };
  if (TERMINAL_STATUSES.has(shipment.currentStatus)) return { updated: false, current: shipment.currentStatus };

  let adapter;
  try {
    adapter = await buildAdapterForConfig(shipment.courierConfigId);
  } catch (err) {
    logger.warn({ err, shipmentId }, 'tracking_adapter_init_failed');
    return { updated: false };
  }

  let result;
  try {
    result = await adapter.trackShipment(shipment.trackingNumber);
  } catch (err) {
    logger.warn({ err, shipmentId, tracking: shipment.trackingNumber }, 'tracking_fetch_failed');
    return { updated: false };
  }

  // Map every event raw → master so we can append to statusHistory.
  const newHistory: Array<{ raw: string; master: string | null; at: string; description?: string; location?: string }> = [];
  let latestMaster: string | null = null;
  for (const ev of result.events) {
    const master = await mapCourierStatus(shipment.courierConfig.courierType, ev.rawStatus, {
      orderId: shipment.orderId,
      trackingNumber: shipment.trackingNumber,
    });
    newHistory.push({
      raw: ev.rawStatus,
      master,
      at: ev.occurredAt.toISOString(),
      description: ev.description,
      location: ev.location,
    });
    if (master) latestMaster = master;
  }
  // If the events array was empty but the top-level rawStatus is present,
  // map that as the current status.
  if (!latestMaster) {
    latestMaster = await mapCourierStatus(shipment.courierConfig.courierType, result.rawStatus, {
      orderId: shipment.orderId,
      trackingNumber: shipment.trackingNumber,
    });
  }

  const updates: Prisma.ShipmentUpdateInput = {
    statusHistory: newHistory as unknown as Prisma.InputJsonValue,
  };
  if (latestMaster && latestMaster !== shipment.currentStatus) {
    updates.currentStatus = latestMaster;
  }
  await prisma.shipment.update({ where: { id: shipment.id }, data: updates });

  // Promote the order's status when the shipment moves forward.
  if (latestMaster && latestMaster !== shipment.order.status) {
    try {
      await changeOrderStatus({
        orderId: shipment.orderId,
        toStatus: latestMaster,
        actorType: 'courier_webhook',
        note: `Tracking poll: ${result.rawStatus}`,
        force: true, // courier wins
        metadata: { tracking: shipment.trackingNumber, courier: shipment.courierConfig.courierType },
      });
    } catch (err) {
      logger.warn({ err, orderId: shipment.orderId, master: latestMaster }, 'order_status_promotion_failed');
    }
  }

  // If we just hit a terminal status, recompute the courier's success rate.
  if (latestMaster && TERMINAL_STATUSES.has(latestMaster)) {
    void recomputeSuccessRate7d(shipment.courierConfigId).catch(() => {});
  }

  return { updated: true, current: latestMaster ?? shipment.currentStatus };
}

/**
 * Sweep — poll every non-terminal shipment. Caller should debounce so we
 * don't hammer the same courier API. Returns a per-shipment summary.
 */
export async function pollAllOpenShipments(opts: { sinceHours?: number; limit?: number } = {}): Promise<{ checked: number; updated: number }> {
  const since = new Date(Date.now() - (opts.sinceHours ?? 30 * 24) * 60 * 60 * 1000);
  const open = await prisma.shipment.findMany({
    where: {
      currentStatus: { notIn: Array.from(TERMINAL_STATUSES) },
      bookedAt: { gte: since },
    },
    take: opts.limit ?? 1000,
  });

  let updated = 0;
  for (const s of open) {
    const r = await pollShipment(s.id);
    if (r.updated) updated++;
  }
  return { checked: open.length, updated };
}
