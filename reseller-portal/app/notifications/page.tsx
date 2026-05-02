'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Spinner, Empty, ErrorBox, fmtDateShort, Button } from '@/components/ui';
import { useApi, useApiMutation } from '@/lib/useApi';

interface Notif { id: string; eventType: string; title: string; body?: string | null; isRead: boolean; createdAt: string }

export default function NotificationsPage() {
  const list = useApi<Notif[]>('/v1/notifications');
  const mut = useApiMutation();

  async function readAll() {
    await mut.mutate('POST', '/v1/notifications/read-all');
    await list.refetch();
  }

  return (
    <AppLayout>
      <Topbar title="Notifications" subtitle="In-app alerts" right={<Button variant="ghost" onClick={readAll}>Mark all read</Button>} />
      <Card>
        {list.loading && <Spinner />}
        {list.error && <ErrorBox error={list.error} />}
        {list.data && list.data.length === 0 && <Empty title="You're all caught up" />}
        {list.data && list.data.length > 0 && (
          <ul className="divide-y divide-zinc-900">
            {list.data.map((n) => (
              <li key={n.id} className={`py-3 ${n.isRead ? 'opacity-60' : ''}`}>
                <div className="flex justify-between gap-4">
                  <div>
                    <div className="font-medium">{n.title}</div>
                    {n.body && <div className="text-xs text-zinc-500 mt-0.5 break-all">{n.body.slice(0, 200)}</div>}
                    <div className="text-[11px] text-zinc-600 mt-1">{n.eventType}</div>
                  </div>
                  <div className="text-xs text-zinc-500 shrink-0">{fmtDateShort(n.createdAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppLayout>
  );
}
