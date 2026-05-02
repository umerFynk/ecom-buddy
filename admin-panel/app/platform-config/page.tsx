'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, Spinner } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Config { id: string; key: string; value: unknown }

export default function PlatformConfigPage() {
  const list = useApi<Config[]>('/v1/admin/platform-config');
  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">Platform config</h1>
      <Card>
        {list.loading && <Spinner />}
        {list.data && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Key</th><th>Value</th></tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="border-b border-zinc-900 align-top">
                  <td className="py-2 font-mono text-xs">{c.key}</td>
                  <td className="text-xs"><pre className="whitespace-pre-wrap text-zinc-300">{JSON.stringify(c.value, null, 2)}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AdminLayout>
  );
}
