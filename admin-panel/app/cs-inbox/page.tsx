'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, Badge, Spinner, Empty } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Conv { id: string; phone: string; status: string; isAiHandling: boolean; lastMessageAt: string; unreadCount: number }

export default function CsInboxPage() {
  const list = useApi<Conv[]>('/v1/admin/cs/conversations');
  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">CS Inbox</h1>
      <Card>
        {list.loading && <Spinner />}
        {list.data && list.data.length === 0 && <Empty title="No customer conversations yet" />}
        {list.data && list.data.length > 0 && (
          <ul className="divide-y divide-zinc-900">
            {list.data.map((c) => (
              <li key={c.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-mono text-sm">{c.phone}</div>
                  <div className="text-xs text-zinc-500">{new Date(c.lastMessageAt).toISOString().slice(0, 16).replace('T', ' ')}</div>
                </div>
                <div className="flex items-center gap-2">
                  {c.isAiHandling ? <Badge tone="info">AI</Badge> : <Badge tone="warn">Human</Badge>}
                  {c.unreadCount > 0 && <Badge tone="bad">{c.unreadCount}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminLayout>
  );
}
