'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Button, Input, Select, Spinner, Empty, ErrorBox, Modal, Badge, fmtDateShort } from '@/components/ui';
import { useApi, useApiMutation } from '@/lib/useApi';

interface Ticket { id: string; subject: string; category: string; priority: string; status: string; createdAt: string }

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'default'> = {
  open: 'warn', in_progress: 'warn', waiting_on_reseller: 'default', resolved: 'good', closed: 'default',
};

export default function SupportPage() {
  const list = useApi<Ticket[]>('/v1/support');
  const [open, setOpen] = useState(false);
  return (
    <AppLayout>
      <Topbar title="Support" subtitle="Tickets you've raised" right={<Button onClick={() => setOpen(true)}>+ New ticket</Button>} />
      <Card>
        {list.loading && <Spinner />}
        {list.error && <ErrorBox error={list.error} />}
        {list.data && list.data.length === 0 && <Empty title="No tickets yet" />}
        {list.data && list.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {list.data.map((t) => (
                <tr key={t.id} className="border-b border-zinc-900">
                  <td className="py-2">{t.subject}</td>
                  <td className="text-xs text-zinc-400">{t.category}</td>
                  <td className="text-xs">{t.priority}</td>
                  <td><Badge tone={TONE[t.status] ?? 'default'}>{t.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="text-zinc-500">{fmtDateShort(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <NewTicketModal open={open} onClose={() => setOpen(false)} onSaved={list.refetch} />
    </AppLayout>
  );
}

function NewTicketModal(props: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('normal');
  const [message, setMessage] = useState('');
  const mut = useApiMutation();

  async function save() {
    const r = await mut.mutate('POST', '/v1/support', { subject, category, priority, message });
    if (r) { props.onSaved(); props.onClose(); setSubject(''); setMessage(''); }
  }

  return (
    <Modal open={props.open} onClose={props.onClose} title="New support ticket">
      <div className="space-y-3">
        <Input value={subject} onChange={setSubject} placeholder="Subject" />
        <div className="flex gap-2">
          <Select value={category} onChange={setCategory} options={[
            { value: 'order_issue', label: 'Order issue' }, { value: 'courier', label: 'Courier' },
            { value: 'inventory', label: 'Inventory' }, { value: 'billing', label: 'Billing' },
            { value: 'bug', label: 'Bug' }, { value: 'feature', label: 'Feature request' },
            { value: 'general', label: 'General' },
          ]} />
          <Select value={priority} onChange={setPriority} options={[
            { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
          ]} />
        </div>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the issue…" rows={5} className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm" />
        <ErrorBox error={mut.error} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button onClick={save} disabled={mut.loading || !subject || !message}>Send</Button></div>
      </div>
    </Modal>
  );
}
