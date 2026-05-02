'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Spinner, Empty, Button, StatusPill, ErrorBox, fmtPkr } from '@/components/ui';
import { useApi, useApiMutation } from '@/lib/useApi';

interface Order { id: string; status: string; customerName: string; phone: string; city: string; amount: string; rtoReasonCategory?: string | null; rtoRescueAttempts: number; shopifyOrderNumber?: string | null }

export default function RtoPage() {
  const list = useApi<Order[]>('/v1/rto/active');
  const mut = useApiMutation();

  async function rescue(id: string) {
    await mut.mutate('POST', '/v1/rto/rescue', { orderId: id });
    await list.refetch();
  }

  return (
    <AppLayout>
      <Topbar title="RTO Rescue" subtitle="Active RTOs sorted by rupee value" />
      <Card>
        {list.loading && <Spinner />}
        {list.error && <ErrorBox error={list.error} />}
        {list.data && list.data.length === 0 && <Empty title="No active RTOs" hint="Returns and failed deliveries appear here." />}
        {list.data && list.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Order</th><th>Customer</th><th>City</th><th className="text-right">Amount</th><th>Reason</th><th>Attempts</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {list.data.map((o) => (
                <tr key={o.id} className="border-b border-zinc-900">
                  <td className="py-2 font-mono text-xs">{o.shopifyOrderNumber ?? o.id.slice(-8)}</td>
                  <td>{o.customerName}</td>
                  <td>{o.city}</td>
                  <td className="text-right">{fmtPkr(o.amount)}</td>
                  <td className="text-xs text-zinc-400">{o.rtoReasonCategory ?? 'unknown'}</td>
                  <td>{o.rtoRescueAttempts}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td className="text-right"><Button onClick={() => rescue(o.id)} disabled={mut.loading}>Run rescue</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <ErrorBox error={mut.error} />
    </AppLayout>
  );
}
