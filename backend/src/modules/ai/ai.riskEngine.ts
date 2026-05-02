import { logger } from '@/lib/logger';
import { AI_MODEL, getOpenAi } from './ai.client';
import { RiskInputCustomer, RiskInputOrder, RiskScoreBreakdown, RiskConfigSnapshot } from '../risk/risk.types';
import { scoreManual } from '../risk/risk.service';

/**
 * Ecom Buddy AI Risk Engine — Confirmation Mode 3.
 *
 * Calls GPT-4o with a structured-output schema and returns a decision in the
 * same RiskScoreBreakdown shape used by Manual mode. Falls back to manual
 * scoring on any error so the order pipeline never blocks on the AI.
 */

const SYSTEM_PROMPT = `You are the Ecom Buddy fraud-and-risk engine for Pakistani COD (cash-on-delivery) e-commerce orders.
You decide how to handle an incoming order based on customer history, location, order value, and risk signals.

Pakistani context to weight heavily:
- COD is the dominant payment method; "fake orders" placed for fun or to harass sellers are a real problem.
- Orders to interior Sindh, interior Balochistan, and small towns historically have far higher RTO (return-to-origin) rates.
- Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad are the lowest-risk metros.
- A customer who has placed 3+ prior orders with a delivery rate above 80% is essentially trusted.
- Night orders (2am-6am local time) and orders well above the typical city ticket size are mildly suspicious.
- Invalid/short addresses and unverifiable phones are strong negative signals.

You MUST respond with a JSON object matching the provided schema. The "decision" field is one of:
- "auto_confirm": skip confirmation entirely (clearly safe).
- "wa_confirm":   send a standard WhatsApp confirmation message and wait for a yes/no reply.
- "otp_required": send a 4-digit OTP that the customer must reply with.
- "cs_review":    hold for a human CS agent to review.
- "auto_cancel":  cancel immediately (clearly fraudulent / hopeless RTO risk).

The "score" is your overall risk on a 0-100 scale (0 = safe, 100 = certain fraud/RTO).
The "factors" array lists the top 2-5 reasons that drove your decision, each with a name + weight.
The "reasoning" is one sentence (≤ 30 words) explaining your call to the seller.`;

const RESPONSE_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    decision: {
      type: 'string' as const,
      enum: ['auto_confirm', 'wa_confirm', 'otp_required', 'cs_review', 'auto_cancel'],
    },
    score: { type: 'integer' as const, minimum: 0, maximum: 100 },
    reasoning: { type: 'string' as const, maxLength: 240 },
    factors: {
      type: 'array' as const,
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['name', 'weight', 'reason'],
        properties: {
          name: { type: 'string' as const },
          weight: { type: 'integer' as const, minimum: -50, maximum: 100 },
          reason: { type: 'string' as const, maxLength: 200 },
        },
      },
    },
  },
  required: ['decision', 'score', 'reasoning', 'factors'],
};

interface AiResponse {
  decision: 'auto_confirm' | 'wa_confirm' | 'otp_required' | 'cs_review' | 'auto_cancel';
  score: number;
  reasoning: string;
  factors: Array<{ name: string; weight: number; reason: string }>;
}

function buildUserPrompt(order: RiskInputOrder, customer: RiskInputCustomer): string {
  const histLine = customer.exists
    ? `Existing customer: ${customer.totalOrders} orders, ${customer.deliveredCount} delivered, ${customer.returnedCount} returned, blacklist=${customer.blacklistLevel}.`
    : `Brand-new customer (no prior orders for this phone).`;
  return [
    `New order to score:`,
    `- Amount: PKR ${order.amount}`,
    `- Payment: ${order.paymentStatus}`,
    `- City: ${order.city} (risk tier ${order.cityTier})`,
    `- Phone valid: ${order.phoneIsValid}`,
    `- Address line 1: "${order.addressLine1}"${order.addressLine2 ? ` / line 2: "${order.addressLine2}"` : ''}`,
    `- Placed at: ${order.createdAt.toISOString()} (local hour ${order.createdAt.getHours()})`,
    `- VIP: ${order.isVip}, tags: ${order.customerTags.join(',') || 'none'}`,
    histLine,
    ``,
    `Return JSON only.`,
  ].join('\n');
}

export async function scoreWithGpt(
  order: RiskInputOrder,
  customer: RiskInputCustomer,
  snap: RiskConfigSnapshot
): Promise<RiskScoreBreakdown> {
  const ai = getOpenAi();
  try {
    const completion = await ai.chat.completions.create({
      model: AI_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(order, customer) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'risk_decision', schema: RESPONSE_SCHEMA, strict: true },
      },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('AI returned empty content');
    const parsed = JSON.parse(content) as AiResponse;

    return {
      base: 0,
      factors: parsed.factors.map((f) => ({ factor: f.name, value: f.weight, reason: f.reason })),
      finalScore: parsed.score,
      cappedAt0: false,
      decision: parsed.decision,
      modeUsed: 'ai_engine',
      thresholds: { otp: snap.otpThreshold, cs: snap.csThreshold, cancel: snap.cancelThreshold },
    };
  } catch (err) {
    logger.warn({ err }, 'ai_risk_engine_failed_falling_back_to_manual');
    const fallback = scoreManual(order, customer, snap);
    return { ...fallback, modeUsed: 'ai_engine' };
  }
}
