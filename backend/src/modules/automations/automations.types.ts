/** Triggers that can fire an automation rule (matches eventBus types). */
export type AutomationTrigger =
  | 'order.created'
  | 'order.status_changed'
  | 'order.confirmed'
  | 'order.dispatched'
  | 'order.delivered'
  | 'order.rto_initiated'
  | 'order.cancelled'
  | 'inventory.low_stock'
  | 'inventory.oos'
  | 'customer.blacklisted';

export type ConditionField =
  | 'amount'
  | 'payment_status'
  | 'city'
  | 'city_tier'
  | 'risk_score'
  | 'courier_type'
  | 'status'
  | 'customer_total_orders'
  | 'customer_blacklist_level'
  | 'tag';

export type FieldOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'is_true' | 'is_false';

export interface Condition {
  field: ConditionField;
  op: FieldOp;
  value?: unknown;
}

export type Action =
  | { type: 'change_status'; toStatus: string; note?: string }
  | { type: 'add_tag'; tag: string }                                    // tag the customer
  | { type: 'send_wa_template'; template: string; variables?: Record<string, string> }
  | { type: 'send_email'; subject: string; body: string }
  | { type: 'notify_user'; title: string; body?: string }
  | { type: 'escalate_cs'; reason: string }
  | { type: 'fire_webhook'; eventType: string };

export interface CompiledRule {
  id: string;
  tenantId: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: Action[];
}
