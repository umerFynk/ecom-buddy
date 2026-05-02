import axios, { AxiosInstance } from 'axios';
import { env } from '@/config/env';
import {
  BookingResult,
  CodStatusResult,
  CourierAdapter,
  CourierBookingInput,
  CourierCredentials,
  CourierError,
  RatesInput,
  RatesResult,
  TrackingResult,
} from '../courier.types';

/**
 * PostEx adapter. Production base: https://api.postex.pk
 *   Auth: header `token: <bearer>`
 *   Endpoints used:
 *     POST /services/integration/api/order/v3/create-order
 *     GET  /services/integration/api/order/v1/track-order/{trackingNum}
 *     PUT  /services/integration/api/order/v1/cancel-order/{trackingNum}
 *     POST /services/integration/api/order/v1/get-cod-status (per spec)
 */
export class PostExAdapter implements CourierAdapter {
  readonly type = 'postex' as const;
  private http: AxiosInstance;

  constructor(creds: CourierCredentials) {
    const token = creds.apiKey ?? env.POSTEX_PLATFORM_TOKEN;
    this.http = axios.create({
      baseURL: creds.baseUrl ?? env.POSTEX_API_BASE,
      headers: { token, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
  }

  async bookShipment(input: CourierBookingInput): Promise<BookingResult> {
    try {
      const res = await this.http.post('/services/integration/api/order/v3/create-order', {
        cityName: input.city,
        customerName: input.customerName,
        customerPhone: input.phone,
        deliveryAddress: [input.addressLine1, input.addressLine2].filter(Boolean).join(', '),
        invoiceDivision: 0,
        invoicePayment: input.paymentStatus === 'cod' ? input.amount : 0,
        items: input.pieces,
        orderRefNumber: input.shopifyOrderNumber ?? input.orderId,
        orderType: input.paymentStatus === 'cod' ? 'Normal' : 'Replacement',
        transactionNotes: input.description.slice(0, 200),
        pickupAddressCode: input.pickupAddress?.contactName ?? '001',
        storeAddressCode: '001',
      });
      const data = res.data?.dist ?? res.data?.data ?? res.data ?? {};
      const tracking = data.trackingNumber ?? data.cn ?? data.trackingNum;
      if (!tracking) throw new CourierError('postex', 'no tracking returned', res.status, res.data);
      return { trackingNumber: String(tracking), labelUrl: data.invoiceLink ?? undefined, rawResponse: res.data };
    } catch (err) {
      throw normalize('postex', err);
    }
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResult> {
    try {
      const res = await this.http.get(`/services/integration/api/order/v1/track-order/${trackingNumber}`);
      const data = res.data?.dist ?? res.data?.data ?? res.data ?? {};
      const status = String(data.transactionStatusMessage ?? data.status ?? 'unknown').toLowerCase();
      const events = (data.transactionStatusHistory ?? []).map((e: { transactionStatusMessage?: string; modifiedDatetime?: string; statusLocation?: string }) => ({
        rawStatus: String(e.transactionStatusMessage ?? '').toLowerCase(),
        occurredAt: e.modifiedDatetime ? new Date(e.modifiedDatetime) : new Date(),
        location: e.statusLocation,
        description: e.transactionStatusMessage,
        raw: e,
      }));
      return { rawStatus: status, events, rawResponse: res.data };
    } catch (err) {
      throw normalize('postex', err);
    }
  }

  async cancelShipment(trackingNumber: string) {
    try {
      const res = await this.http.put(`/services/integration/api/order/v1/cancel-order/${trackingNumber}`);
      return { success: res.status >= 200 && res.status < 300, raw: res.data };
    } catch (err) {
      throw normalize('postex', err);
    }
  }

  async getRates(input: RatesInput): Promise<RatesResult> {
    try {
      const res = await this.http.post('/services/integration/api/order/v1/get-price-calculator', {
        weight: Math.max(0.5, input.weightKg),
        originCityName: input.originCity,
        destinationCityName: input.destinationCity,
      });
      const data = res.data?.dist ?? res.data?.data ?? res.data ?? {};
      return { ratePkr: Number(data.estimatedRate ?? data.totalAmount ?? 0), estimatedDays: Number(data.estimatedDays ?? 3) };
    } catch (err) {
      throw normalize('postex', err);
    }
  }

  async getCodStatus(trackingNumber: string): Promise<CodStatusResult> {
    try {
      const res = await this.http.get(`/services/integration/api/order/v1/cod-status/${trackingNumber}`);
      const data = res.data?.dist ?? res.data?.data ?? res.data ?? {};
      return {
        paid: Boolean(data.isPaid ?? data.paid),
        amountPkr: data.amount ? Number(data.amount) : undefined,
        paidAt: data.paidAt ? new Date(data.paidAt) : undefined,
        raw: res.data,
      };
    } catch (err) {
      throw normalize('postex', err);
    }
  }
}

function normalize(courier: 'postex', err: unknown): CourierError {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string };
  return new CourierError(courier, e.message ?? 'request failed', e.response?.status, e.response?.data);
}
