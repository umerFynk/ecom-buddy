'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Spinner, Empty, ErrorBox, fmtDateShort } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Campaign { id: string; name: string; status: string; sentCount: number; deliveredCount: number; createdAt: string }

export default function MessagingPage() {
  const campaigns = useApi<Campaign[]>('/v1/campaigns');
  return (
    <AppLayout>
      <Topbar title="Messaging" subtitle="WhatsApp campaigns + templates" />
      <Card>
        <div className="text-sm text-zinc-400 mb-3">Campaigns</div>
        {campaigns.loading && <Spinner />}
        {campaigns.error && <ErrorBox error={campaigns.error} />}
        {campaigns.data && campaigns.data.length === 0 && <Empty title="No campaigns yet" />}
        {campaigns.data && campaigns.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Name</th><th>Status</th><th className="text-right">Sent</th><th className="text-right">Delivered</th><th>Created</th></tr>
            </thead>
            <tbody>
              {campaigns.data.map((c) => (
                <tr key={c.id} className="border-b border-zinc-900">
                  <td className="py-2">{c.name}</td>
                  <td className="text-xs text-zinc-400">{c.status}</td>
                  <td className="text-right">{c.sentCount}</td>
                  <td className="text-right text-emerald-400">{c.deliveredCount}</td>
                  <td className="text-zinc-500">{fmtDateShort(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}
