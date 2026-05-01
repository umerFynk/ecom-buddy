'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Me {
  auth: {
    type: 'reseller';
    tenantId: string;
    userId: string;
    role: string;
  };
}

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/v1/auth/me')
      .then((r) => setMe(r.data?.data))
      .catch((e) => setError(e.message ?? 'Failed to load'));
  }, []);

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Dashboard</h1>
      <p className="text-sm text-zinc-400 mb-8">Phase 1 placeholder. Real screens land in Phase 9.</p>
      {error && <div className="text-red-400 text-sm">{error}</div>}
      {me && <pre className="text-xs text-zinc-300 bg-zinc-900 p-4 rounded">{JSON.stringify(me, null, 2)}</pre>}
    </main>
  );
}
