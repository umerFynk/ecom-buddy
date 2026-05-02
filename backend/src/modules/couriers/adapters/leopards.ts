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
 * Leopards Courier merchant API. Form-encoded.
 * Base: https://merchantapi.leopardscourier.com
 *   POST /api/booked_packets/?api_key=...&api_password=...
 *   POST /api/track_packet/?api_key=...&api_password=...
 *   POST /api/cancel_packet/?api_key=...&api_password=...
 *   POST /api/getAllCities/?api_key=...&api_password=...
 */
export class LeopardsAdapter implements CourierAdapter {
  readonly type = 'leopards' as const;
  private http: AxiosInstance;
  private apiKey: string;
  private apiPassword: string;

  constructor(creds: CourierCredentials) {
    this.apiKey = creds.apiKey ?? env.LEOPARDS_PLATFORM_API_KEY;
    this.apiPassword = creds.apiPassword ?? env.LEOPARDS_PLATFORM_API_PASSWORD;
    this.http = axios.create({
      baseURL: creds.baseUrl ?? env.LEOPARDS_API_BASE,
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
    });
  }

  private auth(payload: Record<string, unknown> = {}) {
    return { api_key: this.apiKey, api_password: this.apiPassword, ...payload };
  }

  async bookShipment(input: CourierBookingInput): Promise<BookingResult> {
    try {
      const res = await this.http.post(
        '/api/booked_packets/',
        this.auth({
          booked_packet_weight: Math.round(Math.max(0.1, input.weightKg) * 1000), // in grams
          booked_packet_no_piece: input.pieces,
          booked_packet_collect_amount: input.paymentStatus === 'cod' ? input.amount : 0,
          booked_packet_order_id: input.shopifyOrderNumber ?? input.orderId,
          origin_city: input.pickupAddress?.city ?? 'Karachi',
          destination_city: input.city,
          shipment_name_eng: input.customerName,
          shipment_email: input.email ?? '',
          shipment_phone: input.phone,
          shipment_address: [input.addressLine1, input.addressLine2].filter(Boolean).join(', '),
          consignment_name_eng: input.pickupAddress?.contactName ?? 'Sender',
          consignment_email: '',
          consignment_phone: input.pickupAddress?.contactPhone ?? '03000000000',
          consignment_address: input.pickupAddress?.addressLine1 ?? '',
          special_instructions: input.description.slice(0, 200),
        })
      );
      const data = res.data ?? {};
      const tracking = data.track_number ?? data.trackingNumber;
      if (!tracking) throw new CourierError('leopards', 'no tracking returned', res.status, data);
      return { trackingNumber: String(tracking), labelUrl: data.slip_link, rawResponse: data };
    } catch (err) {
      throw normalize(err);
    }
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResult> {
    try {
      const res = await this.http.post('/api/track_packet/', this.auth({ track_numbers: trackingNumber }));
      const packets = res.data?.packet_list ?? [];
      const head = packets[0] ?? {};
      const events = (head.Tracking_Detail ?? []).map((e: { Status?: string; Activity_datetime?: string; Reciever_Name?: string }) => ({
        rawStatus: String(e.Status ?? '').toLowerCase().replace(/\s+/g, '_'),
        occurredAt: e.Activity_datetime ? new Date(e.Activity_datetime) : new Date(),
        description: e.Status,
        raw: e,
      }));
      return {
        rawStatus: String(head.booked_packet_status ?? head.Status ?? 'unknown').toLowerCase().replace(/\s+/g, '_'),
        events,
        rawResponse: res.data,
      };
    } catch (err) {
      throw normalize(err);
    }
  }

  async cancelShipment(trackingNumber: string) {
    try {
      const res = await this.http.post('/api/cancel_packet/', this.auth({ track_number: trackingNumber }));
      return { success: res.data?.status === 1 || res.data?.success === true, raw: res.data };
    } catch (err) {
      throw normalize(err);
    }
  }

  async getRates(input: RatesInput): Promise<RatesResult> {
    try {
      const res = await this.http.post('/api/getCharges/', this.auth({
        origin_city: input.originCity,
        destination_city: input.destinationCity,
        weight: Math.max(0.5, input.weightKg),
      }));
      return { ratePkr: Number(res.data?.charges ?? 0), estimatedDays: Number(res.data?.tat ?? 3) };
    } catch (err) {
      throw normalize(err);
    }
  }
}

function normalize(err: unknown): CourierError {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string };
  return new CourierError('leopards', e.message ?? 'request failed', e.response?.status, e.response?.data);
}
