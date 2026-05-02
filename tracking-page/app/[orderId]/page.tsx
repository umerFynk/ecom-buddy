'use client';

import { useEffect, useState } from 'react';
import { fetchOrderTimeline, OrderDetail } from '@/lib/api';

interface Props { params: { orderId: string } }

const TONE: Record<string, string> = {
  delivered: 'bg-emerald-100 text-emerald-700',
  out_for_delivery: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-blue-100 text-blue-700',
  dispatched: 'bg-indigo-100 text-indigo-700',
  courier_booked: 'bg-indigo-100 text-indigo-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  pending_confirmation: 'bg-amber-100 text-amber-700',
  rto_initiated: 'bg-red-100 text-red-700',
  rto_returned: 'bg-red-100 text-red-700',
  cancelled_by_seller: 'bg-zinc-200 text-zinc-700',
  unknown: 'bg-zinc-200 text-zinc-700',
};

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.toISOString().slice(0, 10)} ${x.toISOString().slice(11, 16)} UTC`;
}

function fmtMoney(amount: string | number, currency = 'PKR'): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  return `${currency === 'PKR' ? 'Rs' : currency} ${(n ?? 0).toLocaleString()}`;
}

export default function TrackingPage({ params }: Props) {
  const [order, setOrder] = useState<OrderDetail | null | 'loading' | 'not_found'>('loading');

  useEffect(() => {
    fetchOrderTimeline(params.orderId).then((r) => setOrder(r ?? 'not_found'));
  }, [params.orderId]);

  if (order === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-zinc-500">Loading your order…</div>;
  }
  if (order === 'not_found' || !order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Order not found</h1>
        <p className="text-sm text-gray-500 max-w-md">Please use the tracking link from your WhatsApp message. If you keep seeing this page, contact the seller.</p>
      </div>
    );
  }

  const brandColor = order.store?.brandColor ?? '#0EA5E9';
  const tone = TONE[order.status] ?? 'bg-zinc-200 text-zinc-700';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200" style={{ borderTopColor: brandColor, borderTopWidth: 4 }}>
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {order.store?.logoUrl
              ? <img src={order.store.logoUrl} alt={order.store.name} className="h-8" />
              : <div className="text-xl font-semibold" style={{ color: brandColor }}>{order.store?.name ?? 'Order tracking'}</div>}
          </div>
          <div className="text-sm text-gray-500">Order #{order.shopifyOrderNumber ?? order.id.slice(-8)}</div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Status banner */}
        <div className={`rounded-lg p-6 text-center ${tone}`}>
          <div className="text-xs uppercase tracking-widest opacity-75">Order status</div>
          <div className="text-3xl font-bold mt-2 capitalize">{order.status.replace(/_/g, ' ')}</div>
          {order.deliveredAt && <div className="text-sm mt-2 opacity-80">Delivered on {fmtDate(order.deliveredAt)}</div>}
        </div>

        {/* Customer + tracking summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">Ship to</div>
            <div className="font-medium text-gray-900">{order.customerName}</div>
            <div className="text-sm text-gray-600">{order.addressLine1}{order.addressLine2 ? `, ${order.addressLine2}` : ''}</div>
            <div className="text-sm text-gray-600">{order.city}{order.province ? `, ${order.province}` : ''}</div>
            <div className="text-sm text-gray-500 mt-2">{order.phone}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">Tracking</div>
            <div className="flex justify-between text-sm py-1"><span className="text-gray-500">Courier</span><span className="font-medium capitalize">{order.courierType ?? '—'}</span></div>
            <div className="flex justify-between text-sm py-1"><span className="text-gray-500">Tracking #</span><span className="font-mono text-xs">{order.trackingNumber ?? '—'}</span></div>
            <div className="flex justify-between text-sm py-1"><span className="text-gray-500">Payment</span><span className="font-medium uppercase">{order.paymentStatus}</span></div>
            <div className="flex justify-between text-sm py-1"><span className="text-gray-500">Order date</span><span>{order.createdAt.slice(0, 10)}</span></div>
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="text-xs uppercase tracking-wider text-gray-400 mb-4">Order journey</div>
          <ol className="relative border-l-2 border-gray-200 ml-2 space-y-5">
            {order.events.slice().reverse().map((e, i) => (
              <li key={i} className="ml-4">
                <div className="absolute -left-[7px] mt-1 w-3 h-3 rounded-full" style={{ background: brandColor }} />
                <div className="text-sm font-medium text-gray-900 capitalize">{e.toStatus.replace(/_/g, ' ')}</div>
                <div className="text-xs text-gray-500">{fmtDate(e.createdAt)}</div>
                {e.note && <div className="text-xs text-gray-600 mt-0.5">{e.note}</div>}
              </li>
            ))}
          </ol>
        </div>

        {/* Items */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="text-xs uppercase tracking-wider text-gray-400 mb-4">Order details</div>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-400 border-b border-gray-200">
              <tr><th className="py-2">Item</th><th className="text-right">Qty</th><th className="text-right">Price</th></tr>
            </thead>
            <tbody>
              {order.items.map((it, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-2">{it.title}</td>
                  <td className="text-right">{it.quantity}</td>
                  <td className="text-right">{fmtMoney(it.price, order.currency)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} className="text-right pt-3 font-semibold">Total</td>
                <td className="text-right pt-3 font-semibold">{fmtMoney(order.amount, order.currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {order.deliveredAt && order.store?.reviewLink && (
          <div className="text-center">
            <a href={order.store.reviewLink} target="_blank" rel="noreferrer" className="inline-block px-6 py-3 rounded-md text-white font-medium" style={{ background: brandColor }}>
              Rate your experience
            </a>
          </div>
        )}
      </main>

      {!order.store?.hideEbBranding && (
        <footer className="text-center text-xs text-gray-400 py-6">Powered by Ecom Buddy</footer>
      )}
    </div>
  );
}
