import { EventEmitter } from 'events';
import { logger } from './logger';

/**
 * Tiny in-process event bus. Phase 10 may swap for a Redis pub/sub bus when
 * we run multi-process workers. For now everything fits in one Node process,
 * so a plain EventEmitter is enough and avoids the network hop.
 *
 * Listeners are wrapped so a single throw doesn't take down the dispatcher.
 */

export type EbEventType =
  | 'order.created'
  | 'order.status_changed'
  | 'order.confirmed'
  | 'order.dispatched'
  | 'order.delivered'
  | 'order.rto_initiated'
  | 'order.cancelled'
  | 'shipment.status_changed'
  | 'inventory.low_stock'
  | 'inventory.oos'
  | 'customer.blacklisted'
  | 'customer.unblacklisted'
  | 'cs.message.inbound'
  | 'campaign.launched'
  | 'abandoned_cart.recovered';

export interface EbEvent<T = Record<string, unknown>> {
  type: EbEventType;
  tenantId: string;
  occurredAt: Date;
  payload: T;
}

const emitter = new EventEmitter({ captureRejections: true });
emitter.setMaxListeners(50);

export function on<T = Record<string, unknown>>(type: EbEventType, handler: (ev: EbEvent<T>) => Promise<void> | void): void {
  emitter.on(type, async (ev: EbEvent<T>) => {
    try {
      await handler(ev);
    } catch (err) {
      logger.warn({ err, type }, 'event_bus_handler_failed');
    }
  });
}

export function emit<T = Record<string, unknown>>(type: EbEventType, tenantId: string, payload: T): void {
  const ev: EbEvent<T> = { type, tenantId, occurredAt: new Date(), payload };
  emitter.emit(type, ev);
  emitter.emit('*', ev); // wildcard channel for global subscribers (e.g. webhook dispatcher)
}

export function onAny(handler: (ev: EbEvent) => Promise<void> | void): void {
  emitter.on('*', async (ev: EbEvent) => {
    try {
      await handler(ev);
    } catch (err) {
      logger.warn({ err, type: ev.type }, 'event_bus_wildcard_handler_failed');
    }
  });
}
