/**
 * Custom IF/THEN rules engine for risk scoring (BLUEPRINT.md Part 12).
 *
 * Rule shape (stored in risk_custom_rules):
 *   conditions: [
 *     { field: 'city', op: 'eq', value: 'Quetta' },
 *     { field: 'amount', op: 'gt', value: 3000 }
 *   ]
 *   actions: [
 *     { type: 'add', value: 20 }                  // add to running score
 *     { type: 'set', value: 0 }                   // force final score
 *     { type: 'flag', value: 'manual_review' }    // adds to risk_flags[]
 *   ]
 * Conditions are AND-ed together. Multiple rules run in priority order;
 * any `set` short-circuits the running score (but flags still accumulate).
 */

import { RiskInputCustomer, RiskInputOrder } from './risk.types';

export type FieldOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'is_true' | 'is_false';

export interface Condition {
  field: string;
  op: FieldOp;
  value?: unknown;
}

export type Action =
  | { type: 'add'; value: number }
  | { type: 'set'; value: number }
  | { type: 'flag'; value: string };

const SUPPORTED_FIELDS = new Set<string>([
  'amount',
  'payment_status',
  'city',
  'city_tier',
  'phone_valid',
  'address_complete',
  'customer_exists',
  'customer_total_orders',
  'customer_delivered',
  'customer_returned',
  'customer_blacklist_level',
  'customer_tag',
  'is_vip',
  'hour',
]);

function getField(field: string, order: RiskInputOrder, customer: RiskInputCustomer): unknown {
  switch (field) {
    case 'amount':                    return order.amount;
    case 'payment_status':            return order.paymentStatus;
    case 'city':                      return order.city;
    case 'city_tier':                 return order.cityTier;
    case 'phone_valid':               return order.phoneIsValid;
    case 'address_complete':          return Boolean(order.addressLine1 && order.addressLine1.trim().length >= 8);
    case 'customer_exists':           return customer.exists;
    case 'customer_total_orders':     return customer.totalOrders;
    case 'customer_delivered':        return customer.deliveredCount;
    case 'customer_returned':         return customer.returnedCount;
    case 'customer_blacklist_level':  return customer.blacklistLevel;
    case 'customer_tag':              return order.customerTags;
    case 'is_vip':                    return order.isVip;
    case 'hour':                      return order.createdAt.getHours();
    default:                          return undefined;
  }
}

export function evaluateCondition(c: Condition, order: RiskInputOrder, customer: RiskInputCustomer): boolean {
  if (!SUPPORTED_FIELDS.has(c.field)) return false;
  const actual = getField(c.field, order, customer);
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

export function evaluateRule(
  conditions: unknown,
  order: RiskInputOrder,
  customer: RiskInputCustomer
): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return false;
  return (conditions as Condition[]).every((c) => evaluateCondition(c, order, customer));
}
