import { logger } from '@/lib/logger';
import { AI_MODEL, getOpenAi } from './ai.client';
import { env } from '@/config/env';

/**
 * AI search: NL → filter params for the existing list endpoints.
 *
 *   "paid postex march"          → { courier: 'postex', codStatus: 'paid', dateFrom: '2026-03-01', dateTo: '2026-03-31' }
 *   "in transit lahore"          → { status: 'in_transit', city: 'Lahore' }
 *   "high risk customers"        → { blacklistLevel: 'high_risk' }
 *
 * Falls back to a tiny keyword matcher when no OpenAI key is configured.
 */

export interface AiSearchInput {
  tenantId: string;
  query: string;
  table: 'orders' | 'customers' | 'products' | 'shipments';
}

export interface AiSearchResult {
  table: AiSearchInput['table'];
  filters: Record<string, unknown>;
  source: 'openai' | 'keyword_fallback';
}

const FIELD_BY_TABLE: Record<AiSearchInput['table'], { field: string; type: string; description?: string }[]> = {
  orders: [
    { field: 'status', type: 'string', description: 'Order status key (e.g. confirmed, dispatched, in_transit, delivered, rto_returned, cancelled_*)' },
    { field: 'courierType', type: 'string', description: 'postex | leopards | trax | blueex | mnx | callcourier' },
    { field: 'paymentStatus', type: 'string', description: 'cod | prepaid' },
    { field: 'codRemittanceStatus', type: 'string', description: 'pending | paid | short | unknown' },
    { field: 'city', type: 'string' },
    { field: 'q', type: 'string', description: 'Free-text search across phone, customer name, tracking, order number' },
    { field: 'dateFrom', type: 'string', description: 'ISO start date inclusive' },
    { field: 'dateTo', type: 'string', description: 'ISO end date inclusive' },
  ],
  customers: [
    { field: 'q', type: 'string', description: 'name / phone / email substring' },
    { field: 'blacklistLevel', type: 'string', description: 'clean | watch | high_risk | blacklisted | global' },
  ],
  products: [
    { field: 'q', type: 'string', description: 'product title substring' },
    { field: 'storeId', type: 'string' },
  ],
  shipments: [
    { field: 'status', type: 'string' },
    { field: 'courierType', type: 'string' },
    { field: 'city', type: 'string' },
  ],
};

function keywordFallback(input: AiSearchInput): AiSearchResult {
  const q = input.query.toLowerCase();
  const filters: Record<string, unknown> = {};

  // Common cities
  for (const c of ['karachi', 'lahore', 'islamabad', 'rawalpindi', 'faisalabad', 'multan', 'peshawar', 'quetta']) {
    if (q.includes(c)) { filters.city = c[0]!.toUpperCase() + c.slice(1); break; }
  }
  // Couriers
  for (const k of ['postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier']) {
    if (q.includes(k)) { filters.courierType = k; break; }
  }
  // Statuses
  const statusMatches: Array<[RegExp, string]> = [
    [/\bin[ -]?transit\b/, 'in_transit'],
    [/\bout[ -]?for[ -]?delivery\b/, 'out_for_delivery'],
    [/\bdelivered\b/, 'delivered'],
    [/\bdispatch(ed)?\b/, 'dispatched'],
    [/\bconfirmed\b/, 'confirmed'],
    [/\brto\b/, 'rto_returned'],
    [/\bcancel(led)?\b/, 'cancelled_by_seller'],
    [/\bpending\b/, 'pending_confirmation'],
  ];
  for (const [re, value] of statusMatches) {
    if (re.test(q)) { filters.status = value; break; }
  }
  // Payment
  if (/\bprepaid\b/.test(q)) filters.paymentStatus = 'prepaid';
  if (/\bcod\b/.test(q)) filters.paymentStatus = 'cod';
  // COD remittance
  if (/\bpaid\b/.test(q)) filters.codRemittanceStatus = 'paid';
  if (/\bunpaid\b/.test(q)) filters.codRemittanceStatus = 'pending';

  // Blacklist
  for (const lvl of ['clean', 'watch', 'high_risk', 'blacklisted', 'global']) {
    if (q.includes(lvl.replace('_', ' ')) || q.includes(lvl)) { filters.blacklistLevel = lvl; break; }
  }

  // Fallback to free-text q if nothing else matched.
  if (Object.keys(filters).length === 0) filters.q = input.query;

  return { table: input.table, filters, source: 'keyword_fallback' };
}

export async function aiSearch(input: AiSearchInput): Promise<AiSearchResult> {
  if (env.OPENAI_API_KEY === 'stub-openai-api-key') {
    return keywordFallback(input);
  }

  const fields = FIELD_BY_TABLE[input.table];
  const fieldsList = fields.map((f) => `- ${f.field} (${f.type})${f.description ? `: ${f.description}` : ''}`).join('\n');

  const systemPrompt = `Translate a natural-language search query into JSON filter parameters for an e-commerce admin table.
Return ONLY valid filter keys for the "${input.table}" table. Omit anything you cannot infer with confidence.
Today is ${new Date().toISOString().slice(0, 10)} (Pakistan timezone).
Months / weeks / quarters should be expanded to inclusive ISO date ranges.

Available filters:
${fieldsList}`;

  const responseSchema = {
    type: 'object' as const,
    additionalProperties: true,
    properties: Object.fromEntries(fields.map((f) => [f.field, { type: 'string' }])),
  };

  try {
    const ai = getOpenAi();
    const completion = await ai.chat.completions.create({
      model: AI_MODEL,
      temperature: 0.0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input.query },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'filters', schema: responseSchema, strict: false },
      },
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) return keywordFallback(input);
    const parsed = JSON.parse(content);
    // Strip any keys the table doesn't know about.
    const allowedKeys = new Set(fields.map((f) => f.field));
    const filters: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) if (allowedKeys.has(k) && v !== null && v !== '') filters[k] = v;
    if (Object.keys(filters).length === 0) return keywordFallback(input);
    return { table: input.table, filters, source: 'openai' };
  } catch (err) {
    logger.warn({ err }, 'ai_search_openai_failed_falling_back');
    return keywordFallback(input);
  }
}
