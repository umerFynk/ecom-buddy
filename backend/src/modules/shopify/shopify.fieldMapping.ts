import { normalizePakistaniPhone } from '@/lib/phoneNormalize';
import { normalizeCity } from '@/lib/cityNormalize';

/**
 * Default Shopify order → Ecom Buddy field mapping (BLUEPRINT.md Part 15).
 * Resellers can extend by storing per-store custom mappings of
 * note_attribute keys → ecom-buddy field names in stores.field_mapping_json.
 */

export interface ShopifyAddress {
  name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
}

export interface ShopifyLineItem {
  id?: number;
  variant_id?: number | null;
  product_id?: number | null;
  title: string;
  sku?: string | null;
  quantity: number;
  price: string;
}

export interface ShopifyOrderPayload {
  id: number;
  name?: string;
  order_number?: number;
  email?: string;
  phone?: string;
  total_price?: string;
  total_discounts?: string;
  total_shipping_price_set?: { shop_money?: { amount: string } };
  currency?: string;
  financial_status?: 'pending' | 'authorized' | 'paid' | 'partially_paid' | 'refunded' | 'voided' | 'partially_refunded';
  customer?: { phone?: string; email?: string; first_name?: string; last_name?: string };
  shipping_address?: ShopifyAddress;
  billing_address?: ShopifyAddress;
  line_items?: ShopifyLineItem[];
  note?: string;
  note_attributes?: Array<{ name: string; value: string }>;
  created_at?: string;
  cancelled_at?: string;
}

export interface MappedOrder {
  shopifyOrderId: string;
  shopifyOrderNumber: string | null;
  customerName: string;
  phone: string; // normalized
  phoneIsValid: boolean;
  alternatePhone: string | null;
  email: string | null;
  city: string; // canonical
  cityTier: 1 | 2 | 3 | 4;
  province: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string | null;
  country: string;
  amount: number;
  currency: string;
  discount: number;
  shippingFee: number;
  paymentStatus: 'cod' | 'prepaid';
  orderNote: string | null;
  metadata: Record<string, string>;
  items: Array<{
    shopifyVariantId: number | null;
    shopifyProductId: number | null;
    title: string;
    sku: string | null;
    quantity: number;
    price: number;
  }>;
  validation: {
    missingRequired: string[]; // list of required fields that were empty
  };
}

const REQUIRED = ['phone', 'customerName', 'city', 'addressLine1'] as const;

function num(s: string | undefined | null, fallback = 0): number {
  if (s === undefined || s === null || s === '') return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function buildName(addr?: ShopifyAddress, customer?: ShopifyOrderPayload['customer']): string {
  if (addr?.name) return addr.name.trim();
  const parts = [addr?.first_name, addr?.last_name, customer?.first_name, customer?.last_name].filter(Boolean);
  return parts.join(' ').trim();
}

function applyCustomMapping(
  order: ShopifyOrderPayload,
  custom: Record<string, string> | undefined
): Record<string, string> {
  const noteMap = new Map<string, string>();
  for (const attr of order.note_attributes ?? []) noteMap.set(attr.name, attr.value);

  const out: Record<string, string> = {};
  if (!custom) {
    // Even without explicit mapping, dump every note_attribute into metadata.
    for (const [k, v] of noteMap) out[k] = v;
    return out;
  }
  for (const [shopifyKey, ourField] of Object.entries(custom)) {
    const v = noteMap.get(shopifyKey);
    if (v !== undefined) out[ourField] = v;
  }
  // Also keep raw note_attributes in metadata.raw_<key>
  for (const [k, v] of noteMap) out[`raw_${k}`] = v;
  return out;
}

export async function mapShopifyOrder(
  order: ShopifyOrderPayload,
  storeFieldMapping?: Record<string, string>
): Promise<MappedOrder> {
  const ship = order.shipping_address ?? order.billing_address ?? {};
  const customer = order.customer ?? {};

  const rawPhone =
    ship.phone || customer.phone || order.phone || (storeFieldMapping ? '' : '');
  const phoneRes = normalizePakistaniPhone(rawPhone);
  const cityRes = await normalizeCity(ship.city);

  const customerName = buildName(ship, customer);
  const addr1 = (ship.address1 ?? '').trim();
  const addr2 = (ship.address2 ?? '').trim() || null;

  const metadata = applyCustomMapping(order, storeFieldMapping);

  // financial_status mapping per blueprint
  const fin = order.financial_status ?? 'pending';
  const paymentStatus: 'cod' | 'prepaid' =
    fin === 'paid' || fin === 'partially_paid' || fin === 'authorized' ? 'prepaid' : 'cod';

  const mapped: MappedOrder = {
    shopifyOrderId: String(order.id),
    shopifyOrderNumber: order.name ?? (order.order_number ? String(order.order_number) : null),
    customerName,
    phone: phoneRes.normalized ?? rawPhone ?? '',
    phoneIsValid: phoneRes.valid,
    alternatePhone: null,
    email: order.email ?? customer.email ?? null,
    city: cityRes.canonical,
    cityTier: (cityRes.tier as 1 | 2 | 3 | 4) ?? 1,
    province: ship.province ?? cityRes.province ?? null,
    addressLine1: addr1,
    addressLine2: addr2,
    postalCode: ship.zip ?? null,
    country: ship.country ?? 'PK',
    amount: num(order.total_price),
    currency: order.currency ?? 'PKR',
    discount: num(order.total_discounts),
    shippingFee: num(order.total_shipping_price_set?.shop_money?.amount),
    paymentStatus,
    orderNote: order.note ?? null,
    metadata,
    items: (order.line_items ?? []).map((li) => ({
      shopifyVariantId: li.variant_id ?? null,
      shopifyProductId: li.product_id ?? null,
      title: li.title,
      sku: li.sku ?? null,
      quantity: li.quantity,
      price: num(li.price),
    })),
    validation: { missingRequired: [] },
  };

  for (const f of REQUIRED) {
    const v = (mapped as unknown as Record<string, unknown>)[f];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      mapped.validation.missingRequired.push(f);
    }
  }
  if (!phoneRes.valid) mapped.validation.missingRequired.push('phone_invalid');
  if ((mapped.items ?? []).length === 0) mapped.validation.missingRequired.push('order_items');

  return mapped;
}
