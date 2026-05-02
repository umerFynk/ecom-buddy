'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, StatCard, Spinner, Empty, StatusPill, fmtPkr, fmtDateShort } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import Link from 'next/link';

interface Overview {
  kpi: {
    totalOrders: number; deliveredOrders: number; rtoOrders: number;
    grossRevenuePkr: number; netProfitPkr: number;
    rtoRatePct: number; deliveryRatePct: number; confirmationRatePct: number;
    avgOrderValuePkr: number;
  };
  daily: Array<{ date: string; orders: number; delivered: number; rto: number; revenue: number }>;
  insights: string[];
}

interface OrderRow { id: string; status: string; customerName: string; phone: string; city: string; amount: string; createdAt: string; shopifyOrderNumber?: string | null }

export default function Dashboard() {
  const overview = useApi<Overview>('/v1/reports/overview');
  const orders = useApi<OrderRow[]>('/v1/orders?pageSize=10');

  return (
    <AppLayout>
      <Topbar title="Dashboard" subtitle="Today at a glance" />

      {overview.loading && <Spinner />}
      {overview.error && <Card className="text-red-400 text-sm">{overview.error}</Card>}

      {overview.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total orders" value={overview.data.kpi.totalOrders} hint="Last 30 days" />
            <StatCard label="Confirmation rate" value={`${overview.data.kpi.confirmationRatePct}%`} tone="info" />
            <StatCard label="Delivery rate" value={`${overview.data.kpi.deliveryRatePct}%`} tone="good" />
            <StatCard label="RTO rate" value={`${overview.data.kpi.rtoRatePct}%`} tone="bad" />
            <StatCard label="Avg order value" value={fmtPkr(overview.data.kpi.avgOrderValuePkr)} />
            <StatCard label="Gross revenue" value={fmtPkr(overview.data.kpi.grossRevenuePkr)} tone="good" />
            <StatCard label="Net profit" value={fmtPkr(overview.data.kpi.netProfitPkr)} tone="good" />
            <StatCard label="Delivered orders" value={overview.data.kpi.deliveredOrders} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <Card className="lg:col-span-2">
              <div className="text-sm text-zinc-400 mb-3">Last 7 days</div>
              <div className="flex items-end gap-2 h-40">
                {overview.data.daily.map((d) => {
                  const max = Math.max(...overview.data!.daily.map((x) => x.orders), 1);
                  const h = Math.max(2, (d.orders / max) * 130);
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-xs text-zinc-500">{d.orders}</div>
                      <div className="w-full bg-brand/70 rounded-t" style={{ height: h }} />
                      <div className="text-[10px] text-zinc-600">{d.date.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card>
              <div className="text-sm text-zinc-400 mb-3">Auto-insights</div>
              {overview.data.insights.length === 0
                ? <div className="text-sm text-zinc-500">No insights flagged for this period.</div>
                : <ul className="space-y-2 text-sm text-zinc-300">{overview.data.insights.map((i, idx) => <li key={idx}>• {i}</li>)}</ul>}
            </Card>
          </div>
        </>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-zinc-400">Recent orders</div>
          <Link href="/orders" className="text-xs text-brand hover:underline">All orders →</Link>
        </div>
        {orders.loading && <Spinner />}
        {orders.data && orders.data.length === 0 && <Empty title="No orders yet" hint="Orders show up here as Shopify webhooks land or you create them manually." />}
        {orders.data && orders.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr>
                <th className="py-2">Order</th><th>Customer</th><th>City</th>
                <th className="text-right">Amount</th><th>Status</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((o) => (
                <tr key={o.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                  <td className="py-2 font-mono text-xs text-zinc-300">{o.shopifyOrderNumber ?? o.id.slice(-8)}</td>
                  <td>{o.customerName}</td>
                  <td>{o.city}</td>
                  <td className="text-right">{fmtPkr(o.amount)}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td className="text-zinc-500">{fmtDateShort(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}
