'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Spinner, Empty, ErrorBox, fmtPkr, fmtDateShort, StatusPill } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Order { id: string; status: string; customerName: string; phone: string; city: string; amount: string; courierType?: string | null; trackingNumber?: string | null; shopifyOrderNumber?: string | null; createdAt: string }

const ACTIVE_STATUSES = ['courier_booked', 'dispatched', 'in_transit', 'out_for_delivery'];

export default function ShipmentsPage() {
  const ord = useApi<Order[]>(`/v1/orders?pageSize=200&status=${ACTIVE_STATUSES[0]}`);

  return (
    <AppLayout>
      <Topbar title="Shipments" subtitle="Booked + in-transit shipments" />
      <Card>
        {ord.loading && <Spinner />}
        {ord.error && <ErrorBox error={ord.error} />}
        {ord.data && ord.data.length === 0 && <Empty title="No shipments" hint="Book a courier from the Orders tab to see shipments here." />}
        {ord.data && ord.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Order</th><th>Tracking</th><th>Courier</th><th>Customer</th><th>City</th><th className="text-right">Amount</th><th>Status</th><th>Booked</th></tr>
            </thead>
            <tbody>
              {ord.data.map((o) => (
                <tr key={o.id} className="border-b border-zinc-900">
                  <td className="py-2 font-mono text-xs">{o.shopifyOrderNumber ?? o.id.slice(-8)}</td>
                  <td className="text-xs">{o.trackingNumber ?? '—'}</td>
                  <td className="text-xs capitalize">{o.courierType ?? '—'}</td>
                  <td>{o.customerName}</td>
                  <td>{o.city}</td>
                  <td className="text-right">{fmtPkr(o.amount)}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td className="text-zinc-500">{fmtDateShort(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}
