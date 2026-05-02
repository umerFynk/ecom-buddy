'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Input, Select, Spinner, Empty, Badge, fmtDateShort, ErrorBox } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Customer { id: string; name: string | null; phoneNormalized: string; totalOrders: number; deliveredCount: number; returnedCount: number; blacklistLevel: string; lastOrderAt: string | null }

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'default'> = {
  clean: 'good', watch: 'warn', high_risk: 'warn', blacklisted: 'bad', global: 'bad',
};

export default function CustomersPage() {
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (level) qs.set('blacklistLevel', level);
  qs.set('pageSize', '100');
  const items = useApi<Customer[]>(`/v1/customers?${qs.toString()}`, [q, level]);

  return (
    <AppLayout>
      <Topbar title="Customers" subtitle="Master list across all stores" />
      <Card className="mb-4">
        <div className="flex gap-2">
          <Input value={q} onChange={setQ} placeholder="Phone / name / email" />
          <Select
            value={level}
            onChange={setLevel}
            options={[
              { value: '', label: 'All levels' },
              { value: 'clean', label: 'Clean' },
              { value: 'watch', label: 'Watch' },
              { value: 'high_risk', label: 'High risk' },
              { value: 'blacklisted', label: 'Blacklisted' },
              { value: 'global', label: 'Global' },
            ]}
          />
        </div>
      </Card>
      <Card>
        {items.loading && <Spinner />}
        {items.error && <ErrorBox error={items.error} />}
        {items.data && items.data.length === 0 && <Empty title="No customers match" />}
        {items.data && items.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Phone</th><th>Name</th><th>Total</th><th>Delivered</th><th>Returned</th><th>Level</th><th>Last order</th></tr>
            </thead>
            <tbody>
              {items.data.map((c) => (
                <tr key={c.id} className="border-b border-zinc-900">
                  <td className="py-2 font-mono text-xs">{c.phoneNormalized}</td>
                  <td>{c.name ?? '—'}</td>
                  <td>{c.totalOrders}</td>
                  <td className="text-emerald-400">{c.deliveredCount}</td>
                  <td className="text-red-400">{c.returnedCount}</td>
                  <td><Badge tone={TONE[c.blacklistLevel] ?? 'default'}>{c.blacklistLevel}</Badge></td>
                  <td className="text-zinc-500">{fmtDateShort(c.lastOrderAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}
