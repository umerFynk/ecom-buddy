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
 * MNX (M&P) adapter. Bearer-token JSON API.
 *   POST /api/shipment/book
 *   GET  /api/shipment/track/{cn}
 *   POST /api/shipment/cancel
 */
export class MnxAdapter implements CourierAdapter {
  readonly type = 'mnx' as const;
  private http: AxiosInstance;

  constructor(creds: CourierCredentials) {
    const token = creds.apiKey ?? env.MNX_PLATFORM_TOKEN;
    this.http = axios.create({
      baseURL: creds.baseUrl ?? env.MNX_API_BASE,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
  }

  async bookShipment(input: CourierBookingInput): Promise<BookingResult> {
    try {
      const res = await this.http.post('/api/shipment/book', {
        order_no: input.shopifyOrderNumber ?? input.orderId,
        receiver_name: input.customerName,
        receiver_phone: input.phone,
        receiver_address: [input.addressLine1, input.addressLine2].filter(Boolean).join(', '),
        receiver_city: input.city,
        weight: Math.max(0.5, input.weightKg),
        pieces: input.pieces,
        cod_amount: input.paymentStatus === 'cod' ? input.amount : 0,
        product: input.description.slice(0, 200),
      });
      const tracking = res.data?.tracking_no ?? res.data?.cn;
      if (!tracking) throw new CourierError('mnx', 'no tracking returned', res.status, res.data);
      return { trackingNumber: String(tracking), labelUrl: res.data?.label_url, rawResponse: res.data };
    } catch (err) {
      throw normalize(err);
    }
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResult> {
    try {
      const res = await this.http.get(`/api/shipment/track/${trackingNumber}`);
      const data = res.data ?? {};
      const events = (data.events ?? []).map((e: { status?: string; date?: string; location?: string }) => ({
        rawStatus: String(e.status ?? '').toLowerCase().replace(/\s+/g, '_'),
        occurredAt: e.date ? new Date(e.date) : new Date(),
        location: e.location,
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
      const res = await this.http.post('/api/shipment/cancel', { tracking_no: trackingNumber });
      return { success: res.data?.success === true, raw: res.data };
    } catch (err) {
      throw normalize(err);
    }
  }

  async getRates(input: RatesInput): Promise<RatesResult> {
    try {
      const res = await this.http.post('/api/shipment/rates', {
        origin: input.originCity,
        destination: input.destinationCity,
        weight: Math.max(0.5, input.weightKg),
      });
      return { ratePkr: Number(res.data?.rate ?? 0), estimatedDays: Number(res.data?.tat ?? 3) };
    } catch (err) {
      throw normalize(err);
    }
  }
}

function normalize(err: unknown): CourierError {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string };
  return new CourierError('mnx', e.message ?? 'request failed', e.response?.status, e.response?.data);
}
