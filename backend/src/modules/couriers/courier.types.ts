import { CourierType } from '@prisma/client';

export interface CourierBookingInput {
  /** Internal Order id; the adapter sees a denormalized snapshot below. */
  orderId: string;
  shopifyOrderNumber?: string | null;
  customerName: string;
  phone: string; // 03xxxxxxxxx
  email?: string | null;
  city: string;
  province?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  postalCode?: string | null;
  amount: number; // PKR
  paymentStatus: 'cod' | 'prepaid';
  weightKg: number;
  pieces: number;
  description: string; // line-items summary, capped at 200 chars
  pickupAddress?: PickupAddress;
}

export interface PickupAddress {
  contactName?: string;
  contactPhone?: string;
  city: string;
  addressLine1: string;
  addressLine2?: string;
  postalCode?: string;
}

export interface BookingResult {
  trackingNumber: string;
  labelUrl?: string;
  rawResponse?: unknown; // for debugging
}

export interface TrackingEvent {
  rawStatus: string;
  masterStatus?: string;
  occurredAt: Date;
  location?: string;
  description?: string;
  raw?: unknown;
}

export interface TrackingResult {
  rawStatus: string;
  events: TrackingEvent[];
  rawResponse?: unknown;
}

export interface RatesInput {
  weightKg: number;
  originCity: string;
  destinationCity: string;
  amount: number;
}

export interface RatesResult {
  ratePkr: number;
  estimatedDays: number;
}

export interface CodStatusResult {
  paid: boolean;
  amountPkr?: number;
  paidAt?: Date;
  raw?: unknown;
}

export interface CourierAdapter {
  readonly type: CourierType;
  bookShipment(input: CourierBookingInput): Promise<BookingResult>;
  trackShipment(trackingNumber: string): Promise<TrackingResult>;
  cancelShipment(trackingNumber: string): Promise<{ success: boolean; raw?: unknown }>;
  getRates(input: RatesInput): Promise<RatesResult>;
  /** Optional — only some couriers expose COD remittance status per shipment. */
  getCodStatus?(trackingNumber: string): Promise<CodStatusResult>;
}

/** Shape stored encrypted at rest in courier_configs.api_key_encrypted. */
export interface CourierCredentials {
  apiKey?: string;
  apiPassword?: string;
  accountNo?: string;
  pickupAddressKey?: string; // some APIs use a registered pickup id
  baseUrl?: string;
}

export class CourierError extends Error {
  constructor(
    public readonly courier: CourierType,
    message: string,
    public readonly status?: number,
    public readonly raw?: unknown
  ) {
    super(`[${courier}] ${message}`);
  }
}
