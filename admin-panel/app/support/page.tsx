'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, Badge, Spinner, Empty, ErrorBox, fmtDate } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Ticket { id: string; subject: string; category: string; priority: string; status: string; createdAt: string; tenant?: { name: string; plan: string } }
const TONE: Record<string, 'good' | 'warn' | 'bad' | 'default'> = { open: 'warn', in_progress: 'warn', waiting_on_reseller: 'default', resolved: 'good', closed: 'default' };

export default function AdminSupportPage() {
  const tickets = useApi<Ticket[]>('/v1/admin/support');
  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">Support tickets</h1>
      <Card>
        {tickets.loading && <Spinner />}
        {tickets.error && <ErrorBox error={tickets.error} />}
        {tickets.data && tickets.data.length === 0 && <Empty title="No open tickets" />}
        {tickets.data && tickets.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Reseller</th><th>Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {tickets.data.map((t) => (
                <tr key={t.id} className="border-b border-zinc-900">
                  <td className="py-2 text-white">{t.tenant?.name ?? '—'}</td>
                  <td>{t.subject}</td>
                  <td className="text-xs text-zinc-400">{t.category}</td>
                  <td className="text-xs">{t.priority}</td>
                  <td><Badge tone={TONE[t.status] ?? 'default'}>{t.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="text-zinc-500 text-xs">{fmtDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AdminLayout>
  );
}
