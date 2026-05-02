/**
 * Pre-defined WhatsApp template names + body builders for Phase 2 flows.
 * In production, these names must be registered + approved in the Meta
 * Business Manager. For Phase 2 we keep the names + variable schemas in
 * code; resellers can also create custom templates via /v1/wa/templates.
 *
 * Variable position is 1-indexed in WhatsApp template body params.
 */

import { TemplateComponent } from './wa.client';

export type TemplateKey =
  | 'order_confirmation_request' // Path B
  | 'order_otp_request'          // Path C
  | 'order_confirmed'
  | 'order_dispatched'
  | 'order_delivered'
  | 'order_cancelled_no_response'
  | 'order_oos_apology';

export interface TemplateSpec {
  name: string;
  language: 'en' | 'ur';
  preview: (vars: Record<string, string>) => string;
  components: (vars: Record<string, string>) => TemplateComponent[];
}

function bodyParams(...values: string[]): TemplateComponent[] {
  return [
    {
      type: 'body',
      parameters: values.map((v) => ({ type: 'text' as const, text: v })),
    },
  ];
}

export const TEMPLATES: Record<TemplateKey, TemplateSpec> = {
  order_confirmation_request: {
    name: 'order_confirmation_request',
    language: 'en',
    preview: (v) =>
      `Hi ${v.customer_name}, please confirm your order ${v.order_number} for Rs ${v.amount} to ${v.city}. Reply YES to confirm or NO to cancel.`,
    components: (v) => bodyParams(v.customer_name, v.order_number, v.amount, v.city),
  },
  order_otp_request: {
    name: 'order_otp_request',
    language: 'en',
    preview: (v) =>
      `Your verification code for order ${v.order_number} is ${v.otp}. It expires in 30 minutes. Reply with this code to confirm your order.`,
    components: (v) => bodyParams(v.order_number, v.otp),
  },
  order_confirmed: {
    name: 'order_confirmed',
    language: 'en',
    preview: (v) =>
      `Thank you ${v.customer_name}! Your order ${v.order_number} is confirmed. We will dispatch it shortly. Track: ${v.tracking_url}`,
    components: (v) => bodyParams(v.customer_name, v.order_number, v.tracking_url),
  },
  order_dispatched: {
    name: 'order_dispatched',
    language: 'en',
    preview: (v) =>
      `Your order ${v.order_number} has been dispatched via ${v.courier} (${v.tracking_number}). Please keep Rs ${v.cod_amount} ready for delivery. Track: ${v.tracking_url}`,
    components: (v) =>
      bodyParams(v.order_number, v.courier, v.tracking_number, v.cod_amount, v.tracking_url),
  },
  order_delivered: {
    name: 'order_delivered',
    language: 'en',
    preview: (v) => `Your order ${v.order_number} has been delivered. Thank you for shopping with us!`,
    components: (v) => bodyParams(v.order_number),
  },
  order_cancelled_no_response: {
    name: 'order_cancelled_no_response',
    language: 'en',
    preview: (v) =>
      `Hi ${v.customer_name}, your order ${v.order_number} was cancelled because we could not reach you. Reply CONFIRM to reinstate it.`,
    components: (v) => bodyParams(v.customer_name, v.order_number),
  },
  order_oos_apology: {
    name: 'order_oos_apology',
    language: 'en',
    preview: (v) =>
      `Sorry ${v.customer_name}, the item "${v.product_title}" in your order ${v.order_number} is currently out of stock. We will update you when it is back, or your order will be cancelled and refunded.`,
    components: (v) => bodyParams(v.customer_name, v.product_title, v.order_number),
  },
};

/** Generate a fresh 4-digit OTP. */
export function generateOtp(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
