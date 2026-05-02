'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, Badge, Spinner, Empty, fmtDate } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Conv { id: string; status: string; lastMessageAt: string; tenant?: { name: string; plan: string; email: string } }

export default function B2bPage() {
  const list = useApi<Conv[]>('/v1/admin/b2b/conversations');
  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">B2B Inbox</h1>
      <Card>
        {list.loading && <Spinner />}
        {list.data && list.data.length === 0 && <Empty title="No reseller conversations yet" />}
        {list.data && list.data.length > 0 && (
          <ul className="divide-y divide-zinc-900">
            {list.data.map((c) => (
              <li key={c.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-white">{c.tenant?.name ?? '—'}</div>
                  <div className="text-xs text-zinc-500">{c.tenant?.email} · last activity {fmtDate(c.lastMessageAt)}</div>
                </div>
                <Badge tone={c.status === 'open' ? 'warn' : 'good'}>{c.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminLayout>
  );
}
