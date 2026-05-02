import axios, { AxiosInstance } from 'axios';
import { env } from '@/config/env';
import {
  BookingResult,
  CourierAdapter,
  CourierBookingInput,
  CourierCredentials,
  CourierError,
  RatesInput,
  RatesResult,
  TrackingResult,
} from '../courier.types';

/**
 * Trax (TPL) adapter. Bearer-token JSON API.
 * Base: https://api.trax.pk
 *   POST /api/v2/shipment/create
 *   GET  /api/v2/shipment/track/{tracking}
 *   POST /api/v2/shipment/cancel
 *   POST /api/v2/shipment/rates
 */
export class TraxAdapter implements CourierAdapter {
  readonly type = 'trax' as const;
  private http: AxiosInstance;

  constructor(creds: CourierCredentials) {
    const token = creds.apiKey ?? env.TRAX_PLATFORM_TOKEN;
    this.http = axios.create({
      baseURL: creds.baseUrl ?? env.TRAX_API_BASE,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
  }

  async bookShipment(input: CourierBookingInput): Promise<BookingResult> {
    try {
      const res = await this.http.post('/api/v2/shipment/create', {
        consignee_name: input.customerName,
        consignee_phone: input.phone,
        consignee_email: input.email ?? '',
        consignee_address: [input.addressLine1, input.addressLine2].filter(Boolean).join(', '),
        consignee_city: input.city,
        weight: Math.max(0.5, input.weightKg),
        pieces: input.pieces,
        order_id: input.shopifyOrderNumber ?? input.orderId,
        order_type: input.paymentStatus === 'cod' ? 'cod' : 'prepaid',
        cod_amount: input.paymentStatus === 'cod' ? input.amount : 0,
        product_details: input.description.slice(0, 200),
        shipper_address_id: input.pickupAddress?.contactName,
      });
      const tracking = res.data?.tracking_number ?? res.data?.data?.tracking_number;
      if (!tracking) throw new CourierError('trax', 'no tracking returned', res.status, res.data);
      return { trackingNumber: String(tracking), labelUrl: res.data?.label_url, rawResponse: res.data };
    } catch (err) {
      throw normalize(err);
    }
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResult> {
    try {
      const res = await this.http.get(`/api/v2/shipment/track/${trackingNumber}`);
      const data = res.data?.data ?? res.data ?? {};
      const events = (data.history ?? []).map((e: { status?: string; created_at?: string; location?: string; remarks?: string }) => ({
        rawStatus: String(e.status ?? '').toLowerCase().replace(/\s+/g, '_'),
        occurredAt: e.created_at ? new Date(e.created_at) : new Date(),
        location: e.location,
        description: e.remarks,
        raw: e,
      }));
      return {
        rawStatus: String(data.current_status ?? 'unknown').toLowerCase().replace(/\s+/g, '_'),
        events,
        rawResponse: res.data,
      };
    } catch (err) {
      throw normalize(err);
    }
  }

  async cancelShipment(trackingNumber: string) {
    try {
      const res = await this.http.post('/api/v2/shipment/cancel', { tracking_number: trackingNumber });
      return { success: res.data?.success === true, raw: res.data };
    } catch (err) {
      throw normalize(err);
    }
  }

  async getRates(input: RatesInput): Promise<RatesResult> {
    try {
      const res = await this.http.post('/api/v2/shipment/rates', {
        origin: input.originCity,
        destination: input.destinationCity,
        weight: Math.max(0.5, input.weightKg),
        cod_amount: input.amount,
      });
      const d = res.data?.data ?? res.data ?? {};
      return { ratePkr: Number(d.rate ?? d.charges ?? 0), estimatedDays: Number(d.estimated_days ?? 3) };
    } catch (err) {
      throw normalize(err);
    }
  }
}

function normalize(err: unknown): CourierError {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string };
  return new CourierError('trax', e.message ?? 'request failed', e.response?.status, e.response?.data);
}
