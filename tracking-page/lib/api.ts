import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const api = axios.create({ baseURL: API_BASE });

export interface OrderItem { title: string; sku?: string | null; quantity: number; price: string }
export interface OrderEvent { fromStatus: string | null; toStatus: string; createdAt: string; note?: string | null }

export interface OrderDetail {
  id: string;
  shopifyOrderNumber?: string | null;
  status: string;
  customerName: string;
  phone: string;
  city: string;
  province?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  amount: string;
  currency: string;
  paymentStatus: 'cod' | 'prepaid';
  courierType?: string | null;
  trackingNumber?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  items: OrderItem[];
  events: OrderEvent[];
  store?: { name: string; brandColor?: string | null; logoUrl?: string | null; reviewLink?: string | null; hideEbBranding?: boolean };
}

export async function fetchOrderTimeline(orderId: string): Promise<OrderDetail | null> {
  try {
    // Use the dashboard endpoint without auth — but we don't have a public
    // tracking endpoint by design (tenant scope). Phase 10 should add a
    // signed-token tracking URL. For now, the page hits the protected
    // /v1/orders/:id endpoint via a configured public bearer token, OR we
    // surface a "Configure public tracking" message.
    const token = process.env.NEXT_PUBLIC_TRACKING_BEARER;
    const res = await api.get(`/v1/orders/${orderId}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    return res.data?.data ?? null;
  } catch {
    return null;
  }
}
