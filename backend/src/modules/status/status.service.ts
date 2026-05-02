import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { AppError, NotFoundError } from '@/lib/errors';

type Tx = PrismaClient | Prisma.TransactionClient;

let transitionsCache: Map<string, Set<string>> | null = null;
let definitionsCache: Map<string, { isTerminal: boolean; isCancellation: boolean }> | null = null;

async function loadCaches(client: Tx = prisma) {
  if (transitionsCache && definitionsCache) return;
  const [defs, trans] = await Promise.all([
    client.orderStatusDefinition.findMany(),
    client.statusTransition.findMany({ where: { isAllowed: true } }),
  ]);
  const tMap = new Map<string, Set<string>>();
  for (const t of trans) {
    if (!tMap.has(t.fromStatus)) tMap.set(t.fromStatus, new Set());
    tMap.get(t.fromStatus)!.add(t.toStatus);
  }
  transitionsCache = tMap;

  const dMap = new Map<string, { isTerminal: boolean; isCancellation: boolean }>();
  for (const d of defs) dMap.set(d.statusKey, { isTerminal: d.isTerminal, isCancellation: d.isCancellation });
  definitionsCache = dMap;
}

export function invalidateStatusCaches() {
  transitionsCache = null;
  definitionsCache = null;
}

export async function isTransitionAllowed(from: string, to: string, client: Tx = prisma): Promise<boolean> {
  if (from === to) return false;
  await loadCaches(client);
  // If from-status doesn't exist as a definition we still allow it for a fresh order.
  if (from === 'new' && to === 'new') return false;
  const allowed = transitionsCache!.get(from);
  return allowed ? allowed.has(to) : false;
}

export async function isStatusKnown(key: string, client: Tx = prisma): Promise<boolean> {
  await loadCaches(client);
  return definitionsCache!.has(key);
}

export interface ChangeStatusInput {
  orderId: string;
  toStatus: string;
  actorType: 'system' | 'reseller_user' | 'admin' | 'courier_webhook' | 'shopify';
  actorId?: string;
  note?: string;
  metadata?: Prisma.InputJsonValue;
  /** When true, skips the transition allow-list check. Use only for system corrections. */
  force?: boolean;
}

/**
 * Mutates Order.status, appends an OrderEvent row, sets the corresponding
 * timestamp column (confirmedAt / dispatchedAt / deliveredAt / rtoAt /
 * cancelledAt) when applicable. Wrapped in a transaction.
 */
export async function changeOrderStatus(input: ChangeStatusInput) {
  const { orderId, toStatus, actorType, actorId, note, metadata, force = false } = input;

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError(`Order ${orderId} not found`);

    if (order.status === toStatus) return order;

    const known = await isStatusKnown(toStatus, tx);
    if (!known) throw new AppError(`Unknown status: ${toStatus}`, 400, 'unknown_status');

    if (!force) {
      const allowed = await isTransitionAllowed(order.status, toStatus, tx);
      if (!allowed) {
        throw new AppError(
          `Invalid transition: ${order.status} → ${toStatus}`,
          400,
          'invalid_transition',
          { from: order.status, to: toStatus }
        );
      }
    }

    const data: Prisma.OrderUpdateInput = { status: toStatus };
    const now = new Date();
    if (toStatus === 'confirmed' || toStatus === 'auto_confirmed') data.confirmedAt = now;
    if (toStatus === 'dispatched') data.dispatchedAt = now;
    if (toStatus === 'delivered') data.deliveredAt = now;
    if (toStatus === 'rto_initiated' || toStatus === 'rto_returned') data.rtoAt = now;
    const def = definitionsCache!.get(toStatus);
    if (def?.isCancellation) {
      data.cancelledAt = now;
      data.cancelReason = note ?? data.cancelReason;
    }

    const updated = await tx.order.update({ where: { id: orderId }, data });

    await tx.orderEvent.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus,
        actorType,
        actorId,
        note,
        metadata,
      },
    });

    // Side-effects fired AFTER the transaction would be safer, but Prisma's
    // commit is synchronous from our perspective; we hand off to the auto-msg
    // dispatcher which queues the WA and returns immediately.
    queueMicrotask(async () => {
      try {
        const { dispatchAutoMessages } = await import('@/modules/automessages/autoMessages');
        await dispatchAutoMessages({
          orderId,
          fromStatus: order.status,
          toStatus,
          tenantId: order.tenantId,
          storeId: order.storeId,
        });
      } catch {
        /* dispatcher swallows its own errors */
      }
    });

    // Blacklist auto-escalation runs on RTO terminal states.
    if (toStatus === 'rto_returned' || toStatus === 'rto_initiated') {
      queueMicrotask(async () => {
        try {
          const { escalateAfterRto } = await import('@/modules/blacklist/blacklist.service');
          await escalateAfterRto(orderId);
        } catch {
          /* swallow */
        }
      });
    }

    return updated;
  });
}

export async function listAllowedTransitionsFrom(from: string, client: Tx = prisma): Promise<string[]> {
  await loadCaches(client);
  return Array.from(transitionsCache!.get(from) ?? []);
}
