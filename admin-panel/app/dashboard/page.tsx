'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Reseller {
  id: string;
  name: string;
  email: string;
  plan: string;
  prefix: string;
  isActive: boolean;
  _count?: { stores: number; orders: number };
}

export default function Dashboard() {
  const [items, setItems] = useState<Reseller[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/v1/admin/resellers')
      .then((r) => setItems(r.data?.data ?? []))
      .catch((e) => setError(e.message ?? 'Failed to load'));
  }, []);

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-bold text-white mb-6">Resellers</h1>
      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}
      {items && (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500 border-b border-zinc-800">
            <tr>
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Plan</th>
              <th>Prefix</th>
              <th>Stores</th>
              <th>Orders</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className="border-b border-zinc-900">
                <td className="py-2 text-white">{t.name}</td>
                <td>{t.email}</td>
                <td>{t.plan}</td>
                <td className="font-mono text-xs">{t.prefix}</td>
                <td>{t._count?.stores ?? 0}</td>
                <td>{t._count?.orders ?? 0}</td>
                <td>{t.isActive ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
