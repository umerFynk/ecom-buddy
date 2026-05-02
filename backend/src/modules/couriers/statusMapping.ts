import { CourierType } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { changeOrderStatus } from '../status/status.service';

/**
 * Resolve a courier raw status string to a master status.
 *
 * Lookup is case-insensitive and ignores leading/trailing spaces. If the
 * raw status is unknown:
 *   - Log a courier_status_unmapped row (deduped by (courier, raw, order))
 *   - Set the order to "unknown" if it isn't already, and notify Super Admin
 *     via Notification table (Phase 7's admin panel surfaces these).
 *   - Return null so the caller leaves the existing status untouched.
 *
 * Once an admin maps the status via /v1/admin/courier-status-maps, all open
 * unmapped rows for that (courier, raw_status) get re-resolved.
 */

const cache = new Map<string, string>(); // key: `${type}:${raw_lower}` → master

function key(type: CourierType, raw: string): string {
  return `${type}:${raw.trim().toLowerCase()}`;
}

export function invalidateStatusMapCache() {
  cache.clear();
}

export async function mapCourierStatus(
  type: CourierType,
  rawStatus: string,
  ctx?: { orderId?: string; trackingNumber?: string }
): Promise<string | null> {
  if (!rawStatus) return null;
  const k = key(type, rawStatus);
  const cached = cache.get(k);
  if (cached) return cached;

  const row = await prisma.courierStatusMap.findFirst({
    where: { courierType: type, rawStatus: { equals: rawStatus.trim(), mode: 'insensitive' } },
  });
  if (row) {
    cache.set(k, row.masterStatus);
    return row.masterStatus;
  }

  // Unknown — record it.
  await recordUnmapped(type, rawStatus, ctx?.orderId);
  if (ctx?.orderId) {
    try {
      // Don't trample meaningful current statuses — only mark unknown if order
      // is in a courier-driven state already.
      const order = await prisma.order.findUnique({ where: { id: ctx.orderId } });
      if (order && !['delivered', 'rto_returned', 'unknown'].includes(order.status) && order.status.startsWith('cancelled') === false) {
        await changeOrderStatus({
          orderId: order.id,
          toStatus: 'unknown',
          actorType: 'courier_webhook',
          note: `Unmapped ${type} status: ${rawStatus}`,
          force: true,
        });
      }
    } catch (err) {
      logger.warn({ err, orderId: ctx.orderId }, 'failed_setting_order_unknown');
    }
  }
  return null;
}

async function recordUnmapped(type: CourierType, raw: string, orderId?: string): Promise<void> {
  // Dedupe per open row
  const open = await prisma.courierStatusUnmapped.findFirst({
    where: { courierType: type, rawStatus: raw, orderId: orderId ?? null, resolvedAt: null },
  });
  if (open) return;

  await prisma.courierStatusUnmapped.create({
    data: { courierType: type, rawStatus: raw, orderId: orderId ?? null },
  });

  // One platform-level admin notification per (courier, raw) per day.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const recent = await prisma.notification.findFirst({
    where: {
      eventType: 'courier_unknown_status',
      title: { contains: `[${type}]` },
      createdAt: { gte: dayStart },
    },
  });
  if (!recent) {
    // Use the first super_admin tenant... actually notifications is keyed to a
    // tenant. Pull the first tenant of the affected order so the admin panel
    // can route, OR drop into a platform-wide channel via a sentinel tenantId.
    const tenant = orderId
      ? await prisma.order.findUnique({ where: { id: orderId }, select: { tenantId: true } })
      : null;
    if (tenant?.tenantId) {
      await prisma.notification.create({
        data: {
          tenantId: tenant.tenantId,
          eventType: 'courier_unknown_status',
          title: `[${type}] unmapped courier status: ${raw}`,
          body: 'A courier returned a status we have no mapping for. Please add a mapping in Status Manager → Courier Mapping.',
          ...(orderId ? { orderId } : {}),
        },
      });
    }
  }
}

/**
 * After an admin maps a previously-unknown raw status, re-resolve all open
 * unmapped rows for that (courier, raw) and apply the mapping to the orders
 * that are still in "unknown" state.
 */
export async function reResolveUnmapped(type: CourierType, rawStatus: string): Promise<{ resolved: number }> {
  invalidateStatusMapCache();
  const masterRow = await prisma.courierStatusMap.findFirst({
    where: { courierType: type, rawStatus },
  });
  if (!masterRow) return { resolved: 0 };

  const open = await prisma.courierStatusUnmapped.findMany({
    where: { courierType: type, rawStatus, resolvedAt: null },
  });
  let resolved = 0;
  for (const row of open) {
    if (row.orderId) {
      const order = await prisma.order.findUnique({ where: { id: row.orderId } });
      if (order?.status === 'unknown') {
        try {
          await changeOrderStatus({
            orderId: order.id,
            toStatus: masterRow.masterStatus,
            actorType: 'system',
            note: `Re-resolved from unknown via new mapping`,
            force: true,
          });
        } catch (err) {
          logger.warn({ err, orderId: order.id }, 're_resolve_failed');
        }
      }
    }
    await prisma.courierStatusUnmapped.update({
      where: { id: row.id },
      data: { resolvedAt: new Date() },
    });
    resolved++;
  }
  return { resolved };
}
