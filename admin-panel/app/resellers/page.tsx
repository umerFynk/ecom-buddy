'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, Spinner, Empty, ErrorBox, Badge, fmtDate } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Reseller { id: string; name: string; email: string; plan: string; prefix: string; isActive: boolean; trialEndsAt: string | null; createdAt: string; _count?: { stores: number; orders: number } }

export default function ResellersPage() {
  const list = useApi<Reseller[]>('/v1/admin/resellers');
  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">Resellers</h1>
      <Card>
        {list.loading && <Spinner />}
        {list.error && <ErrorBox error={list.error} />}
        {list.data && list.data.length === 0 && <Empty title="No resellers yet" />}
        {list.data && list.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Name</th><th>Email</th><th>Plan</th><th>Prefix</th><th>Stores</th><th>Orders</th><th>Trial ends</th><th>Status</th></tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} className="border-b border-zinc-900">
                  <td className="py-2 text-white">{r.name}</td>
                  <td className="text-zinc-400 text-xs">{r.email}</td>
                  <td className="capitalize">{r.plan}</td>
                  <td className="font-mono text-xs">{r.prefix}</td>
                  <td>{r._count?.stores ?? 0}</td>
                  <td>{r._count?.orders ?? 0}</td>
                  <td className="text-zinc-500 text-xs">{fmtDate(r.trialEndsAt)}</td>
                  <td>{r.isActive ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AdminLayout>
  );
}
