'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Spinner, Empty, ErrorBox, fmtDateShort, Badge } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Inbound { id: string; grnNumber: string; status: string; totalExpected: number; totalReceived: number; warehouse?: { name: string }; createdAt: string }

export default function WmsPage() {
  const inb = useApi<Inbound[]>('/v1/wms/inbound');
  return (
    <AppLayout>
      <Topbar title="WMS" subtitle="Stock at the EB warehouse (3PL)" />
      <Card>
        <div className="text-sm text-zinc-400 mb-3">Inbound shipments</div>
        {inb.loading && <Spinner />}
        {inb.error && <ErrorBox error={inb.error} />}
        {inb.data && inb.data.length === 0 && <Empty title="No inbound shipments" hint="Send stock to the EB warehouse to start using 3PL." />}
        {inb.data && inb.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">GRN</th><th>Warehouse</th><th>Expected</th><th>Received</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {inb.data.map((i) => (
                <tr key={i.id} className="border-b border-zinc-900">
                  <td className="py-2 font-mono text-xs">{i.grnNumber}</td>
                  <td className="text-xs text-zinc-400">{i.warehouse?.name ?? '—'}</td>
                  <td>{i.totalExpected}</td>
                  <td>{i.totalReceived}</td>
                  <td><Badge tone={i.status === 'received' ? 'good' : i.status === 'discrepancy' ? 'warn' : 'default'}>{i.status}</Badge></td>
                  <td className="text-zinc-500">{fmtDateShort(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}
