'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Spinner, Empty, Badge, ErrorBox } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Level {
  id: string; totalStock: number; allocatedStock: number; lowStockThreshold: number;
  variant: { sku: string; product: { title: string } };
}

interface OosEvent { id: string; affectedOrdersCount: number; triggeredAt: string; variant: { sku: string; product: { title: string } } }

export default function InventoryPage() {
  const [lowOnly, setLowOnly] = useState(false);
  const levels = useApi<Level[]>(`/v1/inventory/levels?pageSize=200${lowOnly ? '&lowStockOnly=true' : ''}`, [lowOnly]);
  const oos = useApi<OosEvent[]>('/v1/inventory/oos/events');

  return (
    <AppLayout>
      <Topbar title="Inventory" subtitle="Stock levels + OOS alerts" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-zinc-400">Stock levels</div>
            <label className="text-xs text-zinc-400 flex items-center gap-2">
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
            </label>
          </div>
          {levels.loading && <Spinner />}
          {levels.error && <ErrorBox error={levels.error} />}
          {levels.data && levels.data.length === 0 && <Empty title="No inventory yet" hint="Stock shows up after Shopify sync." />}
          {levels.data && levels.data.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500 border-b border-zinc-800">
                <tr><th className="py-2">Product</th><th>SKU</th><th className="text-right">Total</th><th className="text-right">Allocated</th><th className="text-right">Available</th></tr>
              </thead>
              <tbody>
                {levels.data.map((l) => {
                  const avail = l.totalStock - l.allocatedStock;
                  const low = avail <= l.lowStockThreshold;
                  return (
                    <tr key={l.id} className="border-b border-zinc-900">
                      <td className="py-2">{l.variant.product.title}</td>
                      <td className="text-xs font-mono text-zinc-400">{l.variant.sku}</td>
                      <td className="text-right">{l.totalStock}</td>
                      <td className="text-right text-amber-400">{l.allocatedStock}</td>
                      <td className="text-right">{low ? <Badge tone="bad">{avail}</Badge> : avail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Open OOS events</div>
          {oos.loading && <Spinner />}
          {oos.data && oos.data.length === 0 && <div className="text-sm text-zinc-500">No active OOS alerts.</div>}
          {oos.data && oos.data.length > 0 && (
            <ul className="space-y-2 text-sm">
              {oos.data.map((e) => (
                <li key={e.id} className="border-b border-zinc-900 pb-2">
                  <div className="font-medium">{e.variant.product.title}</div>
                  <div className="text-xs text-zinc-500">{e.variant.sku} · {e.affectedOrdersCount} affected orders</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
