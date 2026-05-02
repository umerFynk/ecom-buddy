'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Button, Input, Select, Spinner, Empty, Badge, ErrorBox, Modal } from '@/components/ui';
import { useApi, useApiMutation } from '@/lib/useApi';

interface Config { id: string; courierType: string; accountName?: string; accountNo?: string; priority: number; isActive: boolean; successRate7d?: number | null }

export default function CouriersPage() {
  const cfgs = useApi<Config[]>('/v1/couriers/configs');
  const [open, setOpen] = useState(false);

  return (
    <AppLayout>
      <Topbar title="Couriers" subtitle="Connected courier accounts and their priority" right={<Button onClick={() => setOpen(true)}>+ Add courier</Button>} />
      <Card>
        {cfgs.loading && <Spinner />}
        {cfgs.error && <ErrorBox error={cfgs.error} />}
        {cfgs.data && cfgs.data.length === 0 && <Empty title="No couriers yet" hint="Add your PostEx, Leopards, Trax, BlueEx, MNX or CallCourier credentials to start booking shipments." />}
        {cfgs.data && cfgs.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Courier</th><th>Account</th><th>Priority</th><th>7-day success</th><th>Active</th></tr>
            </thead>
            <tbody>
              {cfgs.data.map((c) => (
                <tr key={c.id} className="border-b border-zinc-900">
                  <td className="py-2 capitalize">{c.courierType}</td>
                  <td className="text-zinc-400 text-xs">{c.accountName ?? c.accountNo ?? '—'}</td>
                  <td>{c.priority}</td>
                  <td>{c.successRate7d != null ? `${Number(c.successRate7d).toFixed(1)}%` : '—'}</td>
                  <td>{c.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="default">Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <AddCourierModal open={open} onClose={() => setOpen(false)} onSaved={cfgs.refetch} />
    </AppLayout>
  );
}

function AddCourierModal(props: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState('postex');
  const [apiKey, setApiKey] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [accountName, setAccountName] = useState('');
  const [priority, setPriority] = useState(100);
  const mut = useApiMutation();

  async function save() {
    const r = await mut.mutate('POST', '/v1/couriers/configs', {
      courierType: type, accountName, apiKey, apiPassword: apiPassword || undefined, priority,
    });
    if (r) { props.onSaved(); props.onClose(); }
  }

  return (
    <Modal open={props.open} onClose={props.onClose} title="Add a courier">
      <div className="space-y-3">
        <Select value={type} onChange={setType} options={[
          { value: 'postex', label: 'PostEx' }, { value: 'leopards', label: 'Leopards' },
          { value: 'trax', label: 'Trax' }, { value: 'blueex', label: 'BlueEx' },
          { value: 'mnx', label: 'MNX' }, { value: 'callcourier', label: 'CallCourier' },
        ]} />
        <Input value={accountName} onChange={setAccountName} placeholder="Account label (optional)" />
        <Input value={apiKey} onChange={setApiKey} placeholder="API key / token" type="password" />
        <Input value={apiPassword} onChange={setApiPassword} placeholder="API password (Leopards / BlueEx only)" type="password" />
        <Input value={String(priority)} onChange={(v) => setPriority(Number(v) || 0)} placeholder="Priority (lower = first)" />
        <ErrorBox error={mut.error} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button onClick={save} disabled={mut.loading}>Save</Button></div>
      </div>
    </Modal>
  );
}
