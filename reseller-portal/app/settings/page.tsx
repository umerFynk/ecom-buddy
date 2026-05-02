'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Button, Input, Spinner, ErrorBox, Badge, Empty } from '@/components/ui';
import { useApi, useApiMutation } from '@/lib/useApi';

interface ApiKey { id: string; name: string; prefix: string; scope: string; rateLimit: number; isActive: boolean; createdAt: string }
interface User { id: string; email: string; name?: string; role: string; isActive: boolean }
interface Store { id: string; name: string; brandColor?: string; timezone: string }

export default function SettingsPage() {
  return (
    <AppLayout>
      <Topbar title="Settings" subtitle="Stores, team, API keys" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StoresCard />
        <TeamCard />
        <ApiKeysCard />
        <RecognitionModeCard />
      </div>
    </AppLayout>
  );
}

function StoresCard() {
  const stores = useApi<Store[]>('/v1/stores');
  return (
    <Card>
      <div className="text-sm text-zinc-400 mb-3">Stores</div>
      {stores.loading && <Spinner />}
      {stores.data && stores.data.length === 0 && <Empty title="No stores" />}
      {stores.data && stores.data.map((s) => (
        <div key={s.id} className="flex items-center justify-between border-b border-zinc-900 py-2 last:border-0">
          <div>
            <div className="font-medium text-white">{s.name}</div>
            <div className="text-xs text-zinc-500">{s.timezone}</div>
          </div>
          {s.brandColor && <span className="w-4 h-4 rounded" style={{ background: s.brandColor }} />}
        </div>
      ))}
    </Card>
  );
}

function TeamCard() {
  const users = useApi<User[]>('/v1/users');
  return (
    <Card>
      <div className="text-sm text-zinc-400 mb-3">Team</div>
      {users.loading && <Spinner />}
      {users.error && <ErrorBox error={users.error} />}
      {users.data && (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500 border-b border-zinc-800">
            <tr><th className="py-2">Email</th><th>Role</th><th>Status</th></tr>
          </thead>
          <tbody>
            {users.data.map((u) => (
              <tr key={u.id} className="border-b border-zinc-900">
                <td className="py-2">{u.email}</td>
                <td className="text-zinc-400 text-xs">{u.role}</td>
                <td>{u.isActive ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ApiKeysCard() {
  const keys = useApi<ApiKey[]>('/v1/api-keys');
  const [name, setName] = useState('');
  const [showSecret, setShowSecret] = useState<string | null>(null);
  const mut = useApiMutation<{ plaintext: string }>();

  async function generate() {
    if (!name) return;
    const r = await mut.mutate('POST', '/v1/api-keys', { name, scope: 'full_access', rateLimit: 1000 });
    if (r?.plaintext) {
      setShowSecret(r.plaintext);
      setName('');
      await keys.refetch();
    }
  }

  return (
    <Card>
      <div className="text-sm text-zinc-400 mb-3">API keys</div>
      <div className="flex gap-2 mb-3">
        <Input value={name} onChange={setName} placeholder="Key name (e.g. integration-staging)" />
        <Button onClick={generate} disabled={mut.loading}>Generate</Button>
      </div>
      {showSecret && (
        <Card className="mb-3 bg-emerald-950/40 border-emerald-900">
          <div className="text-xs text-emerald-300 mb-1">Save this key now — it won&apos;t be shown again.</div>
          <div className="font-mono text-xs break-all">{showSecret}</div>
          <Button variant="ghost" onClick={() => setShowSecret(null)} className="mt-2 text-xs">Dismiss</Button>
        </Card>
      )}
      <ErrorBox error={mut.error} />
      {keys.data && (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500 border-b border-zinc-800">
            <tr><th className="py-2">Name</th><th>Prefix</th><th>Scope</th><th>Active</th></tr>
          </thead>
          <tbody>
            {keys.data.map((k) => (
              <tr key={k.id} className="border-b border-zinc-900">
                <td className="py-2">{k.name}</td>
                <td className="text-xs font-mono">{k.prefix}…</td>
                <td className="text-xs text-zinc-400">{k.scope}</td>
                <td>{k.isActive ? <Badge tone="good">Active</Badge> : <Badge>Revoked</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function RecognitionModeCard() {
  const [mode, setMode] = useState<'cash_basis' | 'accrual_delivered' | 'accrual_dispatched'>('cash_basis');
  const mut = useApiMutation();
  return (
    <Card>
      <div className="text-sm text-zinc-400 mb-3">Revenue recognition mode</div>
      <p className="text-xs text-zinc-500 mb-3">Cash basis = recognise revenue when COD is remitted. Accrual = recognise on delivery / dispatch.</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {(['cash_basis', 'accrual_delivered', 'accrual_dispatched'] as const).map((m) => (
          <Button key={m} variant={mode === m ? 'primary' : 'ghost'} onClick={() => setMode(m)}>{m.replace('_', ' ')}</Button>
        ))}
      </div>
      <Button onClick={() => mut.mutate('PUT', '/v1/financify/recognition-mode', { mode })} disabled={mut.loading}>Save</Button>
      <ErrorBox error={mut.error} />
    </Card>
  );
}
