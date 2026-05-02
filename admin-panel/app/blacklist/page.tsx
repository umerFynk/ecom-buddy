'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, Badge, Spinner, Empty, ErrorBox } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Customer { id: string; phoneNormalized: string; name: string | null; blacklistLevel: string; totalOrders: number; returnedCount: number }

export default function GlobalBlacklistPage() {
  const list = useApi<Customer[]>('/v1/admin/blacklist');
  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">Global blacklist (Levels 3-4)</h1>
      <Card>
        {list.loading && <Spinner />}
        {list.error && <ErrorBox error={list.error} />}
        {list.data && list.data.length === 0 && <Empty title="No blacklisted customers" />}
        {list.data && list.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Phone</th><th>Name</th><th>Level</th><th>Orders</th><th>Returned</th></tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="border-b border-zinc-900">
                  <td className="py-2 font-mono text-xs">{c.phoneNormalized}</td>
                  <td>{c.name ?? '—'}</td>
                  <td><Badge tone="bad">{c.blacklistLevel}</Badge></td>
                  <td>{c.totalOrders}</td>
                  <td className="text-red-400">{c.returnedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AdminLayout>
  );
}
