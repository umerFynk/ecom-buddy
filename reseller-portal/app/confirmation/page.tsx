'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Spinner, Empty, ErrorBox, fmtPkr, StatusPill } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Order {
  id: string; status: string; customerName: string; phone: string; city: string; amount: string;
  riskScore?: number | null; shopifyOrderNumber?: string | null;
  confirmationLogs?: Array<{ pathUsed: string; sentAt: string; attempts: number }>;
}

export default function ConfirmationPage() {
  const list = useApi<Order[]>('/v1/confirmation/pending');

  return (
    <AppLayout>
      <Topbar title="Confirmation" subtitle="Orders awaiting customer reply" />
      <Card>
        {list.loading && <Spinner />}
        {list.error && <ErrorBox error={list.error} />}
        {list.data && list.data.length === 0 && <Empty title="No pending confirmations" hint="Orders are confirmed automatically or via WhatsApp Y/N reply." />}
        {list.data && list.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Order</th><th>Customer</th><th>City</th><th className="text-right">Amount</th><th>Risk</th><th>Path</th><th>Attempts</th><th>Status</th></tr>
            </thead>
            <tbody>
              {list.data.map((o) => {
                const lg = o.confirmationLogs?.[0];
                return (
                  <tr key={o.id} className="border-b border-zinc-900">
                    <td className="py-2 font-mono text-xs">{o.shopifyOrderNumber ?? o.id.slice(-8)}</td>
                    <td>{o.customerName}</td>
                    <td>{o.city}</td>
                    <td className="text-right">{fmtPkr(o.amount)}</td>
                    <td>{o.riskScore ?? '—'}</td>
                    <td className="text-xs text-zinc-400">{lg?.pathUsed ?? '—'}</td>
                    <td>{lg?.attempts ?? 0}</td>
                    <td><StatusPill status={o.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}
