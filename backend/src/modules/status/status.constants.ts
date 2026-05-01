import { StatusType } from '@prisma/client';

/**
 * The 25 starting statuses (BLUEPRINT.md Part 9). These are seeded but
 * mutable by Super Admin via Status Manager UI. New statuses can be added
 * without code deploys.
 */

export interface StatusDef {
  key: string;
  displayName: string;
  color: string;
  type: StatusType;
  isTerminal: boolean;
  isCancellation: boolean;
  displayOrder: number;
  description: string;
}

export const DEFAULT_STATUSES: StatusDef[] = [
  // Active lifecycle
  { key: 'new',                   displayName: 'New',                   color: '#9CA3AF', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 10,  description: 'Order received from Shopify/CSV/API/manual entry' },
  { key: 'pending_confirmation',  displayName: 'Pending Confirmation',  color: '#F59E0B', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 20,  description: 'WhatsApp confirmation sent, awaiting reply' },
  { key: 'confirmed',             displayName: 'Confirmed',             color: '#10B981', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 30,  description: 'Customer confirmed the order' },
  { key: 'auto_confirmed',        displayName: 'Auto-Confirmed',        color: '#10B981', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 35,  description: 'Auto-confirmed (prepaid / VIP / repeat customer)' },
  { key: 'inventory_allocated',   displayName: 'Inventory Allocated',   color: '#3B82F6', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 40,  description: 'Stock reserved for this order' },
  { key: 'courier_booked',        displayName: 'Courier Booked',        color: '#3B82F6', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 50,  description: 'Shipment created with the courier' },
  { key: 'dispatched',            displayName: 'Dispatched',            color: '#6366F1', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 60,  description: 'Picked up by the courier' },
  { key: 'in_transit',            displayName: 'In Transit',            color: '#6366F1', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 70,  description: 'Moving between courier hubs' },
  { key: 'out_for_delivery',      displayName: 'Out for Delivery',      color: '#8B5CF6', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 80,  description: 'Rider has the parcel for delivery today' },
  { key: 'delivered',             displayName: 'Delivered',             color: '#22C55E', type: 'terminal',     isTerminal: true,  isCancellation: false, displayOrder: 90,  description: 'Customer received the parcel and COD collected' },
  { key: 'partially_delivered',   displayName: 'Partially Delivered',   color: '#84CC16', type: 'active',       isTerminal: false, isCancellation: false, displayOrder: 95,  description: 'Multi-item order; only some items delivered' },

  // Failure / return
  { key: 'failed_delivery',       displayName: 'Failed Delivery',       color: '#EF4444', type: 'failure',      isTerminal: false, isCancellation: false, displayOrder: 100, description: 'Courier attempted delivery; not delivered' },
  { key: 'rto_initiated',         displayName: 'RTO Initiated',         color: '#F97316', type: 'failure',      isTerminal: false, isCancellation: false, displayOrder: 110, description: 'Courier started the return-to-origin process' },
  { key: 'rto_in_transit',        displayName: 'RTO In Transit',        color: '#F97316', type: 'failure',      isTerminal: false, isCancellation: false, displayOrder: 120, description: 'Return parcel moving back to origin' },
  { key: 'rto_returned',          displayName: 'RTO Returned',          color: '#DC2626', type: 'terminal',     isTerminal: true,  isCancellation: false, displayOrder: 130, description: 'Parcel physically returned to the seller' },

  // Cancellations
  { key: 'cancelled_by_seller',     displayName: 'Cancelled by Seller',     color: '#6B7280', type: 'cancellation', isTerminal: true, isCancellation: true, displayOrder: 200, description: 'Seller cancelled the order' },
  { key: 'cancelled_no_response',   displayName: 'Cancelled — No Response', color: '#6B7280', type: 'cancellation', isTerminal: true, isCancellation: true, displayOrder: 210, description: 'Auto-cancelled after confirmation timeout' },
  { key: 'cancelled_fake',          displayName: 'Cancelled — Fake/Risk',   color: '#7F1D1D', type: 'cancellation', isTerminal: true, isCancellation: true, displayOrder: 220, description: 'Risk engine flagged as fake order' },
  { key: 'cancelled_by_customer',   displayName: 'Cancelled by Customer',   color: '#6B7280', type: 'cancellation', isTerminal: true, isCancellation: true, displayOrder: 230, description: 'Customer requested cancellation' },
  { key: 'cancelled_by_courier',    displayName: 'Cancelled by Courier',    color: '#6B7280', type: 'cancellation', isTerminal: true, isCancellation: true, displayOrder: 240, description: 'Courier rejected (unserviceable area / weight / etc)' },

  // Special
  { key: 'unconfirmed_shipped',     displayName: 'Unconfirmed Shipped',     color: '#FB923C', type: 'special', isTerminal: false, isCancellation: false, displayOrder: 300, description: 'Shipped without confirmation; seller accepted the risk' },
  { key: 'on_hold',                 displayName: 'On Hold',                 color: '#FBBF24', type: 'special', isTerminal: false, isCancellation: false, displayOrder: 310, description: 'Manually paused' },
  { key: 'exchange_requested',      displayName: 'Exchange Requested',      color: '#A78BFA', type: 'special', isTerminal: false, isCancellation: false, displayOrder: 320, description: 'Customer requested an exchange' },
  { key: 'refund_processing',       displayName: 'Refund Processing',       color: '#A78BFA', type: 'special', isTerminal: false, isCancellation: false, displayOrder: 330, description: 'Refund being processed' },
  { key: 'unknown',                 displayName: 'Unknown',                 color: '#1F2937', type: 'special', isTerminal: false, isCancellation: false, displayOrder: 999, description: 'Courier sent an unrecognized status; admin alerted' },
];

/**
 * Default allowed transitions. Admins can override via Status Manager UI.
 * Format: from → list of allowed to-statuses.
 */
export const DEFAULT_TRANSITIONS: Record<string, string[]> = {
  new: ['pending_confirmation', 'auto_confirmed', 'confirmed', 'cancelled_by_seller', 'cancelled_fake', 'on_hold'],
  pending_confirmation: ['confirmed', 'cancelled_no_response', 'cancelled_by_customer', 'cancelled_fake', 'on_hold', 'unconfirmed_shipped'],
  confirmed: ['inventory_allocated', 'on_hold', 'cancelled_by_seller', 'cancelled_by_customer'],
  auto_confirmed: ['inventory_allocated', 'on_hold', 'cancelled_by_seller'],
  inventory_allocated: ['courier_booked', 'cancelled_by_seller', 'on_hold'],
  courier_booked: ['dispatched', 'cancelled_by_courier', 'cancelled_by_seller'],
  dispatched: ['in_transit', 'out_for_delivery', 'delivered', 'failed_delivery', 'rto_initiated'],
  in_transit: ['out_for_delivery', 'delivered', 'failed_delivery', 'rto_initiated'],
  out_for_delivery: ['delivered', 'partially_delivered', 'failed_delivery', 'rto_initiated'],
  partially_delivered: ['delivered', 'rto_initiated', 'exchange_requested', 'refund_processing'],
  failed_delivery: ['out_for_delivery', 'rto_initiated', 'in_transit'],
  rto_initiated: ['rto_in_transit', 'rto_returned'],
  rto_in_transit: ['rto_returned'],
  rto_returned: ['refund_processing', 'exchange_requested'],
  on_hold: ['confirmed', 'pending_confirmation', 'cancelled_by_seller', 'inventory_allocated'],
  unconfirmed_shipped: ['dispatched', 'in_transit', 'out_for_delivery', 'delivered', 'rto_initiated'],
  exchange_requested: ['confirmed', 'cancelled_by_seller', 'refund_processing'],
  refund_processing: ['cancelled_by_seller'],
  unknown: ['new', 'in_transit', 'out_for_delivery', 'delivered', 'failed_delivery', 'rto_initiated', 'cancelled_by_courier'],
  // Terminal statuses — no outgoing transitions:
  delivered: [],
  cancelled_by_seller: [],
  cancelled_no_response: [],
  cancelled_fake: [],
  cancelled_by_customer: [],
  cancelled_by_courier: [],
};
