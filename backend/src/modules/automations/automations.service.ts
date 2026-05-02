import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { Action, AutomationTrigger, CompiledRule, Condition } from './automations.types';
import { changeOrderStatus } from '../status/status.service';
import { sendTemplateMessage } from '../wa/wa.service';
import { dispatchNotification } from '../notifications/notifications.service';
import { sendEmail } from '@/lib/email';
import { setConversationStatus, findOrCreateConversation } from '../cs/cs.service';
import { emit } from '@/lib/eventBus';
import type { TemplateKey } from '../wa/wa.templates';
import { TEMPLATES } from '../wa/wa.templates';

/**
 * Automation engine. Runs after every event-bus tick. For each event:
 *   1. Fetch all active rules for the tenant matching the trigger.
 *   2. Build a typed context from the event payload + DB lookups.
 *   3. Evaluate conditions (AND-ed) against the context.
 *   4. Execute the actions for matching rules.
 *   5. Bump rule counters and last_run_at.
 *
 * Errors per-rule never block the loop; we log and continue so a single bad
 * rule can't take down the dispatcher.
 */

interface AutomationContext {
  tenantId: string;
  trigger: AutomationTrigger;
  orderId?: string;
  // Materialized context for condition matching:
  amount?: number;
  payment_status?: 'cod' | 'prepaid';
  city?: string;
  city_tier?: number;
  risk_score?: number;
  courier_type?: string | null;
  status?: string;
  customer_id?: string | null;
  customer_total_orders?: number;
  customer_blacklist_level?: string;
  customer_phone?: string;
  customer_name?: string;
  tags?: string[];
}

async function buildContext(trigger: AutomationTrigger, tenantId: string, payload: Record<string, unknown>): Promise<AutomationContext> {
  const ctx: AutomationContext = { tenantId, trigger };

  if (typeof payload.orderId === 'string') {
    const order = await prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { customer: true },
    });
    if (order) {
      ctx.orderId = order.id;
      ctx.amount = Number(order.amount);
      ctx.payment_status = order.paymentStatus;
      ctx.city = order.city;
      ctx.risk_score = order.riskScore ?? 0;
      ctx.courier_type = order.courierType;
      ctx.status = order.status;
      ctx.customer_id = order.customerId;
      ctx.customer_phone = order.phone;
      ctx.customer_name = order.customerName;
      if (order.customer) {
        ctx.customer_total_orders = order.customer.totalOrders;
        ctx.customer_blacklist_level = order.customer.blacklistLevel;
        ctx.tags = order.customer.tags;
      }
      // Resolve city tier
      const cityRow = await prisma.cityAlias.findUnique({ where: { canonicalName: order.city } });
      ctx.city_tier = cityRow?.tier ?? 1;
    }
  }
  return ctx;
}

function evaluateCondition(c: Condition, ctx: AutomationContext): boolean {
  const actual = (ctx as unknown as Record<string, unknown>)[c.field];
  switch (c.op) {
    case 'eq':       return actual === c.value;
    case 'neq':      return actual !== c.value;
    case 'gt':       return typeof actual === 'number' && typeof c.value === 'number' && actual > c.value;
    case 'gte':      return typeof actual === 'number' && typeof c.value === 'number' && actual >= c.value;
    case 'lt':       return typeof actual === 'number' && typeof c.value === 'number' && actual < c.value;
    case 'lte':      return typeof actual === 'number' && typeof c.value === 'number' && actual <= c.value;
    case 'in':       return Array.isArray(c.value) && (c.value as unknown[]).includes(actual);
    case 'contains': return Array.isArray(actual) && (actual as unknown[]).includes(c.value);
    case 'is_true':  return actual === true;
    case 'is_false': return actual === false;
    default:         return false;
  }
}

function evaluateConditions(conds: Condition[], ctx: AutomationContext): boolean {
  if (!conds || conds.length === 0) return true;
  return conds.every((c) => evaluateCondition(c, ctx));
}

async function runAction(action: Action, ctx: AutomationContext): Promise<void> {
  switch (action.type) {
    case 'change_status': {
      if (!ctx.orderId) return;
      await changeOrderStatus({
        orderId: ctx.orderId,
        toStatus: action.toStatus,
        actorType: 'system',
        note: action.note ?? `Automation rule action`,
        force: true,
      });
      return;
    }
    case 'add_tag': {
      if (!ctx.customer_id) return;
      const customer = await prisma.customer.findUnique({ where: { id: ctx.customer_id } });
      if (!customer) return;
      const next = Array.from(new Set([...customer.tags, action.tag]));
      await prisma.customer.update({ where: { id: customer.id }, data: { tags: next } });
      return;
    }
    case 'send_wa_template': {
      if (!ctx.customer_phone) return;
      // Validate the template name against the registered set; if it's a custom
      // template we still try (TEMPLATES map covers our built-ins).
      const builtins = Object.keys(TEMPLATES) as TemplateKey[];
      const templateName = action.template as TemplateKey;
      if (!builtins.includes(templateName)) {
        logger.info({ template: action.template }, 'automation_unknown_template_skipped');
        return;
      }
      await sendTemplateMessage({
        tenantId: ctx.tenantId,
        phone: ctx.customer_phone,
        template: templateName,
        orderId: ctx.orderId,
        variables: {
          customer_name: ctx.customer_name ?? 'Friend',
          order_number: ctx.orderId?.slice(-8) ?? '',
          amount: String(ctx.amount ?? ''),
          city: ctx.city ?? '',
          ...(action.variables ?? {}),
        },
      });
      return;
    }
    case 'send_email': {
      const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
      if (!tenant?.email) return;
      await sendEmail({ to: tenant.email, subject: action.subject, html: action.body, text: action.body.replace(/<[^>]+>/g, '') });
      return;
    }
    case 'notify_user': {
      await dispatchNotification({
        tenantId: ctx.tenantId,
        eventType: 'automation',
        title: action.title,
        body: action.body,
        orderId: ctx.orderId,
      });
      return;
    }
    case 'escalate_cs': {
      if (!ctx.customer_phone) return;
      const conv = await findOrCreateConversation({ tenantId: ctx.tenantId, phone: ctx.customer_phone, customerId: ctx.customer_id ?? null });
      await setConversationStatus({ conversationId: conv.id, status: 'cs_handling' });
      await dispatchNotification({
        tenantId: ctx.tenantId,
        eventType: 'automation',
        title: 'CS escalation from automation',
        body: action.reason,
        orderId: ctx.orderId,
      });
      return;
    }
    case 'fire_webhook': {
      // Re-emit through the bus so the webhook dispatcher picks it up.
      emit(action.eventType as never, ctx.tenantId, { orderId: ctx.orderId, source: 'automation' });
      return;
    }
  }
}

/**
 * Public entry called by the event bus subscriber. Returns the number of
 * matched + executed rules.
 */
export async function runAutomations(trigger: AutomationTrigger, tenantId: string, payload: Record<string, unknown>): Promise<{ matched: number }> {
  const rules = await prisma.automationRule.findMany({
    where: { tenantId, trigger, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (rules.length === 0) return { matched: 0 };

  const ctx = await buildContext(trigger, tenantId, payload);

  let matched = 0;
  for (const r of rules) {
    try {
      const conditions = (r.conditions as unknown as Condition[]) ?? [];
      if (!evaluateConditions(conditions, ctx)) continue;

      const actions = (r.actions as unknown as Action[]) ?? [];
      for (const action of actions) {
        try {
          await runAction(action, ctx);
        } catch (err) {
          logger.warn({ err, ruleId: r.id, action }, 'automation_action_failed');
        }
      }
      matched++;
      void prisma.automationRule
        .update({ where: { id: r.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } })
        .catch(() => {});
    } catch (err) {
      logger.warn({ err, ruleId: r.id }, 'automation_rule_failed');
    }
  }
  return { matched };
}

/** Pre-built rule library for the dashboard. */
export function getRuleLibrary(): Array<{ name: string; trigger: AutomationTrigger; conditions: Condition[]; actions: Action[] }> {
  return [
    {
      name: 'Auto-cancel high-risk orders',
      trigger: 'order.created',
      conditions: [{ field: 'risk_score', op: 'gte', value: 95 }],
      actions: [{ type: 'change_status', toStatus: 'cancelled_fake', note: 'Auto-cancelled by automation: risk_score >= 95' }],
    },
    {
      name: 'VIP first-confirm',
      trigger: 'order.created',
      conditions: [{ field: 'customer_blacklist_level', op: 'eq', value: 'clean' }, { field: 'customer_total_orders', op: 'gte', value: 5 }],
      actions: [{ type: 'change_status', toStatus: 'auto_confirmed', note: 'Trusted-customer auto-confirm' }],
    },
    {
      name: 'Notify on RTO over Rs 5000',
      trigger: 'order.rto_initiated',
      conditions: [{ field: 'amount', op: 'gt', value: 5000 }],
      actions: [{ type: 'notify_user', title: 'High-value RTO', body: 'A high-ticket RTO just kicked off — call the customer.' }],
    },
    {
      name: 'WA dispatch confirmation to customer',
      trigger: 'order.dispatched',
      conditions: [],
      actions: [{ type: 'send_wa_template', template: 'order_dispatched' }],
    },
  ];
}
