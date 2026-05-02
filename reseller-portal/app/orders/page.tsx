'use client';

import { useState, FormEvent } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Input, Select, Button, Empty, Spinner, StatusPill, fmtPkr, fmtDateShort, Modal, ErrorBox } from '@/components/ui';
import { useApi, useApiMutation } from '@/lib/useApi';
import { api } from '@/lib/api';

interface Order { id: string; status: string; customerName: string; phone: string; city: string; amount: string; createdAt: string; courierType?: string | null; trackingNumber?: string | null; shopifyOrderNumber?: string | null }

export default function OrdersPage() {
  const [status, setStatus] = useState('');
  const [city, setCity] = useState('');
  const [q, setQ] = useState('');
  const [aiQuery, setAiQuery] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);

  const qs = new URLSearchParams();
  qs.set('pageSize', '50');
  if (status) qs.set('status', status);
  if (city) qs.set('city', city);
  if (q) qs.set('q', q);
  const orders = useApi<Order[]>(`/v1/orders?${qs.toString()}`, [status, city, q]);

  const aiSearch = useApiMutation<{ filters: Record<string, string> }>();

  async function runAiSearch(e: FormEvent) {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    const r = await aiSearch.mutate('POST', '/v1/ai/search', { query: aiQuery, table: 'orders' });
    if (r?.filters) {
      setStatus(String(r.filters.status ?? ''));
      setCity(String(r.filters.city ?? ''));
      setQ(String(r.filters.q ?? ''));
    }
  }

  return (
    <AppLayout>
      <Topbar title="Orders" subtitle="All orders across your stores" />

      <Card className="mb-4">
        <form onSubmit={runAiSearch} className="flex gap-2 mb-3">
          <Input value={aiQuery} onChange={setAiQuery} placeholder="AI search: e.g. 'in transit lahore postex'" />
          <Button type="submit" disabled={aiSearch.loading}>{aiSearch.loading ? 'Thinking…' : 'AI search'}</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'new', label: 'New' },
              { value: 'pending_confirmation', label: 'Pending confirmation' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'dispatched', label: 'Dispatched' },
              { value: 'in_transit', label: 'In transit' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'rto_returned', label: 'RTO returned' },
            ]}
          />
          <Input value={city} onChange={setCity} placeholder="City" className="max-w-[160px]" />
          <Input value={q} onChange={setQ} placeholder="Phone / name / tracking" className="max-w-[260px]" />
          {(status || city || q) && (
            <Button variant="ghost" onClick={() => { setStatus(''); setCity(''); setQ(''); setAiQuery(''); }}>Clear</Button>
          )}
        </div>
      </Card>

      <Card>
        {orders.loading && <Spinner />}
        {orders.error && <ErrorBox error={orders.error} />}
        {orders.data && orders.data.length === 0 && <Empty title="No orders match" hint="Try clearing filters." />}
        {orders.data && orders.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr>
                <th className="py-2">Order</th><th>Customer</th><th>Phone</th><th>City</th>
                <th className="text-right">Amount</th><th>Courier</th><th>Status</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((o) => (
                <tr key={o.id} className="border-b border-zinc-900 hover:bg-zinc-900/30 cursor-pointer" onClick={() => setSelected(o)}>
                  <td className="py-2 font-mono text-xs text-zinc-300">{o.shopifyOrderNumber ?? o.id.slice(-8)}</td>
                  <td>{o.customerName}</td>
                  <td className="text-xs text-zinc-500">{o.phone}</td>
                  <td>{o.city}</td>
                  <td className="text-right">{fmtPkr(o.amount)}</td>
                  <td className="text-xs text-zinc-500">{o.courierType ?? '—'}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td className="text-zinc-500">{fmtDateShort(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <OrderDrawer order={selected} onClose={() => setSelected(null)} onChanged={orders.refetch} />
    </AppLayout>
  );
}

function OrderDrawer(props: { order: Order | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<{ items: Array<{ title: string; quantity: number; price: string }>; events: Array<{ toStatus: string; createdAt: string; note?: string | null }> }>(
    props.order ? `/v1/orders/${props.order.id}` : '',
    [props.order?.id]
  );
  const mut = useApiMutation();

  if (!props.order) return null;

  async function changeStatus(to: string) {
    if (!confirm(`Move to ${to}?`)) return;
    await mut.mutate('PATCH', `/v1/orders/${props.order!.id}/status`, { status: to });
    await props.onChanged();
    await detail.refetch();
  }

  return (
    <Modal open={Boolean(props.order)} onClose={props.onClose} title={`Order ${props.order.shopifyOrderNumber ?? props.order.id.slice(-8)}`}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div><div className="text-zinc-500 text-xs">Customer</div><div>{props.order.customerName}</div></div>
          <div><div className="text-zinc-500 text-xs">Phone</div><div>{props.order.phone}</div></div>
          <div><div className="text-zinc-500 text-xs">City</div><div>{props.order.city}</div></div>
          <div><div className="text-zinc-500 text-xs">Amount</div><div>{fmtPkr(props.order.amount)}</div></div>
          <div><div className="text-zinc-500 text-xs">Status</div><div><StatusPill status={props.order.status} /></div></div>
          <div><div className="text-zinc-500 text-xs">Tracking</div><div className="text-xs">{props.order.trackingNumber ?? '—'}</div></div>
        </div>
        <div className="border-t border-zinc-800 pt-3">
          <div className="text-zinc-500 text-xs mb-2">Items</div>
          {detail.data?.items?.map((it, i) => (
            <div key={i} className="flex justify-between text-sm py-1">
              <span>{it.quantity}× {it.title}</span>
              <span className="text-zinc-400">{fmtPkr(it.price)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-zinc-800 pt-3">
          <div className="text-zinc-500 text-xs mb-2">Timeline</div>
          <ul className="space-y-1.5 text-xs">
            {detail.data?.events?.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-zinc-600 shrink-0">{fmtDateShort(e.createdAt)}</span>
                <StatusPill status={e.toStatus} />
                {e.note && <span className="text-zinc-500">— {e.note}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-zinc-800 pt-3 flex flex-wrap gap-2">
          <Button onClick={() => changeStatus('confirmed')} disabled={mut.loading}>Confirm</Button>
          <Button variant="ghost" onClick={() => changeStatus('on_hold')}>Hold</Button>
          <Button variant="danger" onClick={() => changeStatus('cancelled_by_seller')}>Cancel</Button>
        </div>
        <ErrorBox error={mut.error} />
      </div>
    </Modal>
  );
}
