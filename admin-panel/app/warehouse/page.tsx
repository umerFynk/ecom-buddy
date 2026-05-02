'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, Spinner, Empty } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Warehouse { id: string; name: string; city?: string; isActive: boolean }
interface PickTask { id: string; status: string; createdAt: string; order?: { id: string; customerName: string; city: string } }
interface PackTask { id: string; status: string; createdAt: string; order?: { id: string; customerName: string; city: string } }

export default function WarehousePage() {
  const wh = useApi<Warehouse[]>('/v1/admin/wms/warehouses');
  const pick = useApi<PickTask[]>('/v1/admin/wms/pick-tasks');
  const pack = useApi<PackTask[]>('/v1/admin/wms/pack-tasks');

  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">Warehouse</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Warehouses ({wh.data?.length ?? 0})</div>
          {wh.loading && <Spinner />}
          {wh.data && wh.data.length === 0 && <Empty title="No warehouses configured" />}
          {wh.data && wh.data.map((w) => (
            <div key={w.id} className="border-b border-zinc-900 py-2">
              <div className="font-medium">{w.name}</div>
              <div className="text-xs text-zinc-500">{w.city ?? '—'}</div>
            </div>
          ))}
        </Card>
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Pick tasks ({pick.data?.length ?? 0})</div>
          {pick.loading && <Spinner />}
          {pick.data && pick.data.length === 0 && <Empty title="No pick tasks" />}
          {pick.data && pick.data.slice(0, 20).map((t) => (
            <div key={t.id} className="border-b border-zinc-900 py-2 text-sm">
              <div>{t.order?.customerName ?? '—'} <span className="text-zinc-500">· {t.order?.city}</span></div>
              <div className="text-xs text-zinc-500">{t.status}</div>
            </div>
          ))}
        </Card>
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Pack tasks ({pack.data?.length ?? 0})</div>
          {pack.loading && <Spinner />}
          {pack.data && pack.data.length === 0 && <Empty title="No pack tasks" />}
          {pack.data && pack.data.slice(0, 20).map((t) => (
            <div key={t.id} className="border-b border-zinc-900 py-2 text-sm">
              <div>{t.order?.customerName ?? '—'} <span className="text-zinc-500">· {t.order?.city}</span></div>
              <div className="text-xs text-zinc-500">{t.status}</div>
            </div>
          ))}
        </Card>
      </div>
    </AdminLayout>
  );
}
