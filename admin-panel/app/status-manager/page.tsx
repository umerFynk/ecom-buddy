'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, Spinner, Badge } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Def { statusKey: string; displayName: string; color: string; type: string; isTerminal: boolean }
interface Trans { fromStatus: string; toStatus: string; isAllowed: boolean }
interface Map { courierType: string; rawStatus: string; masterStatus: string }
interface Unmapped { courierType: string; rawStatus: string; receivedAt: string }

export default function StatusManagerPage() {
  const defs = useApi<Def[]>('/v1/status/definitions');
  const trans = useApi<Trans[]>('/v1/admin/status/transitions');
  const maps = useApi<Map[]>('/v1/admin/courier-status-maps');
  const unmapped = useApi<Unmapped[]>('/v1/admin/courier-status-unmapped');

  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">Status manager</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Status definitions</div>
          {defs.loading && <Spinner />}
          {defs.data && (
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500 border-b border-zinc-800">
                <tr><th className="py-2">Key</th><th>Name</th><th>Type</th><th>Terminal</th></tr>
              </thead>
              <tbody>
                {defs.data.map((d) => (
                  <tr key={d.statusKey} className="border-b border-zinc-900">
                    <td className="py-2 font-mono text-xs">{d.statusKey}</td>
                    <td><span className="inline-flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.displayName}</span></td>
                    <td className="text-xs text-zinc-400">{d.type}</td>
                    <td>{d.isTerminal ? <Badge>terminal</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Allowed transitions</div>
          {trans.data && (
            <ul className="space-y-1 text-xs font-mono">
              {trans.data.slice(0, 50).map((t, i) => <li key={i} className="text-zinc-400">{t.fromStatus} → <span className="text-zinc-200">{t.toStatus}</span></li>)}
              {trans.data.length > 50 && <li className="text-zinc-500">+ {trans.data.length - 50} more</li>}
            </ul>
          )}
        </Card>
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Courier status maps ({maps.data?.length ?? 0})</div>
          {maps.data && (
            <table className="w-full text-xs font-mono">
              <thead className="text-left text-zinc-500 border-b border-zinc-800">
                <tr><th className="py-2">Courier</th><th>Raw</th><th>Master</th></tr>
              </thead>
              <tbody>
                {maps.data.slice(0, 30).map((m, i) => (
                  <tr key={i} className="border-b border-zinc-900">
                    <td className="py-1">{m.courierType}</td>
                    <td>{m.rawStatus}</td>
                    <td className="text-emerald-400">{m.masterStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Unmapped statuses ({unmapped.data?.length ?? 0})</div>
          {unmapped.data && unmapped.data.length === 0 && <div className="text-sm text-emerald-400">All courier statuses mapped.</div>}
          {unmapped.data && unmapped.data.length > 0 && (
            <ul className="space-y-1 text-xs">
              {unmapped.data.map((u, i) => <li key={i}><Badge tone="bad">{u.courierType}</Badge> <span className="font-mono">{u.rawStatus}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}
