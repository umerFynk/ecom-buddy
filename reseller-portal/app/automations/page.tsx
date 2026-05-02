'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Badge, Spinner, Empty, ErrorBox, fmtDateShort } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Rule { id: string; name: string; trigger: string; isActive: boolean; runCount: number; lastRunAt: string | null }

export default function AutomationsPage() {
  const rules = useApi<Rule[]>('/v1/automations');
  const lib = useApi<Array<{ name: string; trigger: string }>>('/v1/automations/library');

  return (
    <AppLayout>
      <Topbar title="Automations" subtitle="IF/THEN rules" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <div className="text-sm text-zinc-400 mb-3">Your rules</div>
          {rules.loading && <Spinner />}
          {rules.error && <ErrorBox error={rules.error} />}
          {rules.data && rules.data.length === 0 && <Empty title="No automation rules yet" hint="Use the rule library on the right as a starting point." />}
          {rules.data && rules.data.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500 border-b border-zinc-800">
                <tr><th className="py-2">Name</th><th>Trigger</th><th>Active</th><th>Runs</th><th>Last run</th></tr>
              </thead>
              <tbody>
                {rules.data.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-900">
                    <td className="py-2">{r.name}</td>
                    <td className="text-xs text-zinc-400">{r.trigger}</td>
                    <td>{r.isActive ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}</td>
                    <td>{r.runCount}</td>
                    <td className="text-zinc-500">{fmtDateShort(r.lastRunAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Rule library</div>
          {lib.data && (
            <ul className="space-y-2">
              {lib.data.map((r, i) => (
                <li key={i} className="border-b border-zinc-900 pb-2">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-zinc-500">{r.trigger}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
