'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, Spinner, Empty } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Channel { id: string; name: string; description?: string; createdAt: string }

export default function InternalChatPage() {
  const list = useApi<Channel[]>('/v1/admin/internal-chat/channels');
  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">Internal chat</h1>
      <Card>
        {list.loading && <Spinner />}
        {list.data && list.data.length === 0 && <Empty title="No channels yet" hint="Create #cs-team or #urgent to get started." />}
        {list.data && list.data.length > 0 && (
          <ul className="space-y-2">
            {list.data.map((c) => (
              <li key={c.id} className="border-b border-zinc-900 pb-2">
                <div className="font-medium">#{c.name}</div>
                {c.description && <div className="text-xs text-zinc-500">{c.description}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminLayout>
  );
}
