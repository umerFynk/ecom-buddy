import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { CourierError, CourierBookingInput, BookingResult } from './courier.types';
import { buildAdapterForConfig } from './factory';
import { rankCourierCandidates } from './assignment';
import { changeOrderStatus } from '../status/status.service';

const BOOKABLE_STATUSES = new Set([
  'confirmed',
  'auto_confirmed',
  'inventory_allocated',
  'unconfirmed_shipped',
]);

export interface BookOrderInput {
  orderId: string;
  /** When set, skip auto-assignment and use this courier_config exactly. */
  preferredCourierConfigId?: string;
  actorType?: 'reseller_user' | 'system';
  actorId?: string;
}

export interface BookOrderResult {
  orderId: string;
  shipmentId?: string;
  courierConfigId?: string;
  trackingNumber?: string;
  labelUrl?: string;
  attempted: Array<{ courierConfigId: string; courierType: string; error: string }>;
  status: 'booked' | 'failed';
  reason?: string;
}

function describeOrder(items: Array<{ title: string; quantity: number }>): string {
  return items.map((i) => `${i.quantity}x ${i.title}`).join(', ').slice(0, 200);
}

/** Single-order booking with failover across ranked courier candidates. */
export async function bookOrder(input: BookOrderInput): Promise<BookOrderResult> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { items: true, store: true },
  });
  if (!order) throw new Error(`Order ${input.orderId} not found`);

  if (!BOOKABLE_STATUSES.has(order.status)) {
    return {
      orderId: order.id,
      attempted: [],
      status: 'failed',
      reason: `Order is in status "${order.status}" — not bookable`,
    };
  }

  const totalWeightKg = order.weightGrams ? order.weightGrams / 1000 : 0.5;
  const pieces = order.itemCount || order.items.reduce((acc, i) => acc + i.quantity, 0) || 1;

  const bookingInput: CourierBookingInput = {
    orderId: order.id,
    shopifyOrderNumber: order.shopifyOrderNumber,
    customerName: order.customerName,
    phone: order.phone,
    email: order.email,
    city: order.city,
    province: order.province,
    addressLine1: order.addressLine1,
    addressLine2: order.addressLine2,
    postalCode: order.postalCode,
    amount: Number(order.amount),
    paymentStatus: order.paymentStatus,
    weightKg: totalWeightKg,
    pieces,
    description: describeOrder(order.items),
  };

  const candidates = await rankCourierCandidates({
    tenantId: order.tenantId,
    city: order.city,
    preferredCourierConfigId: input.preferredCourierConfigId,
  });

  if (candidates.length === 0) {
    return {
      orderId: order.id,
      attempted: [],
      status: 'failed',
      reason: 'No active courier configured for this tenant / city',
    };
  }

  const attempted: BookOrderResult['attempted'] = [];

  for (const cand of candidates) {
    try {
      const adapter = await buildAdapterForConfig(cand.config.id);
      const result: BookingResult = await adapter.bookShipment({ ...bookingInput, pickupAddress: extractPickup(cand.config) });

      const shipment = await prisma.shipment.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          courierConfigId: cand.config.id,
          trackingNumber: result.trackingNumber,
          labelUrl: result.labelUrl ?? null,
          currentStatus: 'courier_booked',
          weightKg: new Prisma.Decimal(totalWeightKg),
        },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: {
          courierConfigId: cand.config.id,
          courierType: cand.config.courierType,
          trackingNumber: result.trackingNumber,
          labelUrl: result.labelUrl ?? null,
        },
      });

      await changeOrderStatus({
        orderId: order.id,
        toStatus: 'courier_booked',
        actorType: input.actorType ?? 'reseller_user',
        actorId: input.actorId,
        note: `Booked with ${cand.config.courierType} (config ${cand.config.id})`,
        metadata: { shipmentId: shipment.id, candidate: cand.reason },
      });

      return {
        orderId: order.id,
        shipmentId: shipment.id,
        courierConfigId: cand.config.id,
        trackingNumber: result.trackingNumber,
        labelUrl: result.labelUrl,
        attempted,
        status: 'booked',
      };
    } catch (err) {
      const ce = err as CourierError;
      attempted.push({
        courierConfigId: cand.config.id,
        courierType: cand.config.courierType,
        error: ce.message ?? String(err),
      });
      logger.warn({ err, orderId: order.id, courierType: cand.config.courierType }, 'courier_booking_failed_failing_over');
    }
  }

  return {
    orderId: order.id,
    attempted,
    status: 'failed',
    reason: 'All courier candidates failed (see attempted[])',
  };
}

/** Bulk booking. Returns per-order results. Continues past per-order errors. */
export async function bookOrdersBulk(input: { tenantId: string; orderIds: string[]; preferredCourierConfigId?: string; actorId?: string }): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  results: BookOrderResult[];
}> {
  const results: BookOrderResult[] = [];
  for (const orderId of input.orderIds) {
    try {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.tenantId !== input.tenantId) {
        results.push({ orderId, attempted: [], status: 'failed', reason: 'Order not found in tenant scope' });
        continue;
      }
      const r = await bookOrder({
        orderId,
        preferredCourierConfigId: input.preferredCourierConfigId,
        actorType: 'reseller_user',
        actorId: input.actorId,
      });
      results.push(r);
    } catch (err) {
      results.push({ orderId, attempted: [], status: 'failed', reason: (err as Error).message });
    }
  }
  return {
    total: results.length,
    succeeded: results.filter((r) => r.status === 'booked').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}

function extractPickup(cfg: { pickupAddress: Prisma.JsonValue | null }): CourierBookingInput['pickupAddress'] | undefined {
  if (!cfg.pickupAddress || typeof cfg.pickupAddress !== 'object') return undefined;
  const p = cfg.pickupAddress as Record<string, string>;
  return {
    contactName: p.contactName,
    contactPhone: p.contactPhone,
    city: p.city ?? 'Karachi',
    addressLine1: p.addressLine1 ?? '',
    addressLine2: p.addressLine2,
    postalCode: p.postalCode,
  };
}
