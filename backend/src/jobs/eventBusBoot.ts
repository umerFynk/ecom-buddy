import { logger } from '@/lib/logger';
import { onAny, on } from '@/lib/eventBus';
import { runAutomations } from '@/modules/automations/automations.service';
import { dispatchEvent } from '@/modules/webhooks/webhooks.service';
import { dispatchNotification } from '@/modules/notifications/notifications.service';
import type { AutomationTrigger } from '@/modules/automations/automations.types';

const NOTIFY_DEFAULT_TITLES: Record<string, string> = {
  'order.confirmed':       'Order confirmed',
  'order.dispatched':      'Order dispatched',
  'order.delivered':       'Order delivered',
  'order.rto_initiated':   'RTO initiated',
  'order.cancelled':       'Order cancelled',
  'inventory.low_stock':   'Low stock alert',
  'inventory.oos':         'Item out of stock',
  'customer.blacklisted':  'Customer blacklisted',
};

/**
 * Wire the in-process event bus to its three downstream consumers:
 *   - automations engine
 *   - outgoing webhooks dispatcher
 *   - in-app/email/WA notification dispatcher
 *
 * Should be called once at boot (before workers/server start handling traffic).
 */
export function bootEventBusSubscribers(): void {
  // Automations
  onAny(async (ev) => {
    const trigger = ev.type as AutomationTrigger;
    try {
      await runAutomations(trigger, ev.tenantId, ev.payload as Record<string, unknown>);
    } catch (err) {
      logger.warn({ err, type: ev.type }, 'event_bus_automation_failed');
    }
  });

  // Outgoing webhooks
  onAny(async (ev) => {
    try {
      await dispatchEvent({ tenantId: ev.tenantId, eventType: ev.type, payload: ev.payload as Record<string, unknown> });
    } catch (err) {
      logger.warn({ err, type: ev.type }, 'event_bus_webhook_failed');
    }
  });

  // Notifications — fire only for events that have a default title mapped.
  for (const [eventType, title] of Object.entries(NOTIFY_DEFAULT_TITLES)) {
    on(eventType as never, async (ev) => {
      try {
        await dispatchNotification({
          tenantId: ev.tenantId,
          eventType,
          title,
          body: JSON.stringify(ev.payload).slice(0, 240),
          orderId: (ev.payload as { orderId?: string }).orderId,
        });
      } catch (err) {
        logger.warn({ err, eventType }, 'event_bus_notification_failed');
      }
    });
  }

  logger.info('event_bus_subscribers_booted');
}
