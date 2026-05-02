import { Router } from 'express';
import crypto from 'crypto';
import { env } from '@/config/env';
import { prisma } from '@/db/prisma';
import { ok, fail } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';

/**
 * Public order tracking endpoint. URL pattern:
 *   /v1/track/{orderId}/{signature}
 * where signature = first 16 hex chars of HMAC-SHA256(JWT_SECRET, orderId).
 *
 * No auth header is required — the signature in the URL itself proves the
 * caller has permission (it's a per-order capability URL). Customers receive
 * the full URL via WhatsApp.
 *
 * Returns the same shape /v1/orders/:id returns but trimmed to public-safe
 * fields (no risk score, no internal notes, no metadata).
 */

export const trackRouter = Router();

export function signOrderId(orderId: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(orderId).digest('hex').slice(0, 16);
}

trackRouter.get(
  '/:orderId/:signature',
  asyncHandler(async (req, res) => {
    const { orderId, signature } = req.params;
    if (!orderId || !signature) return fail(res, 'Missing parameters', 400, 'missing_params');
    const expected = signOrderId(orderId);
    let valid = false;
    try {
      valid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      valid = false;
    }
    if (!valid) return fail(res, 'Invalid tracking signature', 401, 'invalid_signature');

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { select: { title: true, sku: true, quantity: true, price: true } },
        events: { select: { fromStatus: true, toStatus: true, createdAt: true, note: true }, orderBy: { createdAt: 'asc' } },
        store: { select: { name: true, brandColor: true, logoUrl: true, reviewLink: true, hideEbBranding: true } },
      },
    });
    if (!order) return fail(res, 'Order not found', 404, 'not_found');

    // Trim sensitive fields.
    return ok(res, {
      id: order.id,
      shopifyOrderNumber: order.shopifyOrderNumber,
      status: order.status,
      customerName: order.customerName,
      phone: maskPhone(order.phone),
      city: order.city,
      province: order.province,
      addressLine1: order.addressLine1,
      addressLine2: order.addressLine2,
      amount: order.amount.toString(),
      currency: order.currency,
      paymentStatus: order.paymentStatus,
      courierType: order.courierType,
      trackingNumber: order.trackingNumber,
      deliveredAt: order.deliveredAt,
      createdAt: order.createdAt,
      items: order.items,
      events: order.events,
      store: order.store,
    });
  })
);

function maskPhone(p: string): string {
  if (!p || p.length < 8) return p;
  return p.slice(0, 4) + '*****' + p.slice(-2);
}
