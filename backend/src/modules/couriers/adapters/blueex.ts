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
 * BlueEx adapter. Username/password JSON API.
 * Base: https://benapi.blue-ex.com
 *   POST /api/v2/shipment/book   (multipart-style JSON)
 *   GET  /api/v2/shipment/status/{cn}
 *   POST /api/v2/shipment/cancel
 */
export class BlueExAdapter implements CourierAdapter {
  readonly type = 'blueex' as const;
  private http: AxiosInstance;
  private user: string;
  private password: string;

  constructor(creds: CourierCredentials) {
    this.user = creds.apiKey ?? env.BLUEEX_PLATFORM_USER;
    this.password = creds.apiPassword ?? env.BLUEEX_PLATFORM_PASSWORD;
    this.http = axios.create({
      baseURL: creds.baseUrl ?? env.BLUEEX_API_BASE,
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
    });
  }

  async bookShipment(input: CourierBookingInput): Promise<BookingResult> {
    try {
      const res = await this.http.post('/api/v2/shipment/book', {
        user: this.user,
        password: this.password,
        shipper_name: input.pickupAddress?.contactName ?? 'Sender',
        shipper_phone: input.pickupAddress?.contactPhone ?? '03000000000',
        shipper_address: input.pickupAddress?.addressLine1 ?? '',
        shipper_city: input.pickupAddress?.city ?? 'Karachi',
        consignee_name: input.customerName,
        consignee_phone: input.phone,
        consignee_address: [input.addressLine1, input.addressLine2].filter(Boolean).join(', '),
        consignee_city: input.city,
        consignee_country: 'PAKISTAN',
        order_id: input.shopifyOrderNumber ?? input.orderId,
        product_details: input.description.slice(0, 200),
        weight: Math.max(0.5, input.weightKg),
        pieces: input.pieces,
        cod_amount: input.paymentStatus === 'cod' ? input.amount : 0,
        service_code: input.paymentStatus === 'cod' ? 'BE' : 'OE',
      });
      const tracking = res.data?.cn ?? res.data?.tracking_number;
      if (!tracking) throw new CourierError('blueex', 'no tracking returned', res.status, res.data);
      return { trackingNumber: String(tracking), labelUrl: res.data?.label_url, rawResponse: res.data };
    } catch (err) {
      throw normalize(err);
    }
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResult> {
    try {
      const res = await this.http.get(`/api/v2/shipment/status/${trackingNumber}`, {
        auth: { username: this.user, password: this.password },
      });
      const data = res.data ?? {};
      const events = (data.tracking ?? []).map((e: { status?: string; datetime?: string; location?: string }) => ({
        rawStatus: String(e.status ?? '').toUpperCase(),
        occurredAt: e.datetime ? new Date(e.datetime) : new Date(),
        location: e.location,
        raw: e,
      }));
      return {
        rawStatus: String(data.shipment_status ?? data.status ?? 'UNKNOWN').toUpperCase(),
        events,
        rawResponse: res.data,
      };
    } catch (err) {
      throw normalize(err);
    }
  }

  async cancelShipment(trackingNumber: string) {
    try {
      const res = await this.http.post('/api/v2/shipment/cancel', {
        user: this.user,
        password: this.password,
        cn: trackingNumber,
      });
      return { success: res.data?.success === true || res.data?.status === 'success', raw: res.data };
    } catch (err) {
      throw normalize(err);
    }
  }

  async getRates(input: RatesInput): Promise<RatesResult> {
    try {
      const res = await this.http.post('/api/v2/shipment/rates', {
        user: this.user,
        password: this.password,
        origin_city: input.originCity,
        destination_city: input.destinationCity,
        weight: Math.max(0.5, input.weightKg),
        cod_amount: input.amount,
      });
      const d = res.data ?? {};
      return { ratePkr: Number(d.rate ?? d.charges ?? 0), estimatedDays: Number(d.tat ?? 3) };
    } catch (err) {
      throw normalize(err);
    }
  }
}

function normalize(err: unknown): CourierError {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string };
  return new CourierError('blueex', e.message ?? 'request failed', e.response?.status, e.response?.data);
}
