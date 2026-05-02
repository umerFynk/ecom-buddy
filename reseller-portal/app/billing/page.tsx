'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Button, Spinner, ErrorBox, fmtPkr } from '@/components/ui';
import { useApi, useApiMutation } from '@/lib/useApi';

interface Plans {
  starter: { pkr: number; stripePriceId?: string };
  growth:  { pkr: number; stripePriceId?: string };
  scale:   { pkr: number; stripePriceId?: string };
}

export default function BillingPage() {
  const plans = useApi<Plans>('/v1/billing/plans');
  const mut = useApiMutation<{ url?: string; reason?: string }>();

  async function upgrade(plan: 'growth' | 'scale') {
    const portal = process.env.NEXT_PUBLIC_RESELLER_URL ?? 'http://localhost:3000';
    const r = await mut.mutate('POST', '/v1/billing/checkout', {
      plan,
      successUrl: `${portal}/billing?status=success`,
      cancelUrl: `${portal}/billing?status=cancel`,
    });
    if (r?.url) window.location.href = r.url;
  }

  return (
    <AppLayout>
      <Topbar title="Billing" subtitle="Plans + usage + invoices" />
      <ErrorBox error={mut.error} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.loading && <Spinner />}
        {plans.data && (
          <>
            <Card>
              <div className="text-sm text-zinc-400">Starter</div>
              <div className="text-3xl font-semibold mt-1">{fmtPkr(plans.data.starter.pkr)}<span className="text-sm text-zinc-500">/mo</span></div>
              <ul className="mt-3 text-xs text-zinc-400 space-y-1">
                <li>Up to 200 orders/mo</li>
                <li>Shared WA number</li>
                <li>1,000 API calls/hr</li>
              </ul>
              <Button variant="ghost" disabled className="mt-4 w-full">Current plan</Button>
            </Card>
            <Card className="ring-2 ring-brand/40">
              <div className="text-sm text-zinc-400">Growth</div>
              <div className="text-3xl font-semibold mt-1">{fmtPkr(plans.data.growth.pkr)}<span className="text-sm text-zinc-500">/mo</span></div>
              <ul className="mt-3 text-xs text-zinc-400 space-y-1">
                <li>Unlimited orders</li>
                <li>Your own WA number</li>
                <li>2,000 API calls/hr</li>
                <li>Outgoing webhooks</li>
              </ul>
              <Button onClick={() => upgrade('growth')} disabled={mut.loading} className="mt-4 w-full">Upgrade to Growth</Button>
            </Card>
            <Card>
              <div className="text-sm text-zinc-400">Scale</div>
              <div className="text-3xl font-semibold mt-1">{fmtPkr(plans.data.scale.pkr)}<span className="text-sm text-zinc-500">/mo</span></div>
              <ul className="mt-3 text-xs text-zinc-400 space-y-1">
                <li>5,000 API calls/hr</li>
                <li>Custom tracking domain</li>
                <li>White-label tracking</li>
                <li>Priority support</li>
              </ul>
              <Button onClick={() => upgrade('scale')} disabled={mut.loading} className="mt-4 w-full">Upgrade to Scale</Button>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
