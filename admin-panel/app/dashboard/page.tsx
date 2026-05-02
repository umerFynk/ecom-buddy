'use client';

import { AdminLayout } from '@/components/Layout';
import { Card, StatCard, Spinner, Empty, ErrorBox, Badge, fmtPkr } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Overview {
  resellers: { total: number; active: number; byPlan: Record<string, number> };
  orders: { today: number; month: number; monthDelivered: number; monthRto: number; monthDeliveryRatePct: number; monthRtoRatePct: number };
  financials: { mrrPkr: number; arrPkr: number; recognizedRevenueMonthPkr: number; netProfitMonthPkr: number };
  growth: { trialEndingIn7Days: number; churnedThisMonth: number };
}

interface CourierHealth { courier: string; shipments7d: number; delivered7d: number; deliveryRatePct: number; openUnmappedStatuses: number }

export default function AdminDashboard() {
  const ov = useApi<Overview>('/v1/admin/dashboard/overview');
  const ch = useApi<CourierHealth[]>('/v1/admin/dashboard/courier-health');

  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold text-white mb-6">Platform overview</h1>
      {ov.loading && <Spinner />}
      {ov.error && <ErrorBox error={ov.error} />}
      {ov.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Resellers" value={ov.data.resellers.total} hint={`${ov.data.resellers.active} active`} />
            <StatCard label="Orders today" value={ov.data.orders.today} />
            <StatCard label="MRR" value={fmtPkr(ov.data.financials.mrrPkr)} hint={`ARR ${fmtPkr(ov.data.financials.arrPkr)}`} />
            <StatCard label="Net profit (mo)" value={fmtPkr(ov.data.financials.netProfitMonthPkr)} />
            <StatCard label="Orders this month" value={ov.data.orders.month} />
            <StatCard label="Delivery rate" value={`${ov.data.orders.monthDeliveryRatePct}%`} />
            <StatCard label="RTO rate" value={`${ov.data.orders.monthRtoRatePct}%`} />
            <StatCard label="Trial ending 7d" value={ov.data.growth.trialEndingIn7Days} />
          </div>
          <Card className="mb-6">
            <div className="text-sm text-zinc-400 mb-3">Plan distribution</div>
            <div className="flex gap-3">
              {Object.entries(ov.data.resellers.byPlan).map(([plan, count]) => (
                <Badge key={plan}>{plan}: {count}</Badge>
              ))}
            </div>
          </Card>
        </>
      )}

      <Card>
        <div className="text-sm text-zinc-400 mb-3">Courier health (7-day)</div>
        {ch.loading && <Spinner />}
        {ch.data && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Courier</th><th className="text-right">Shipments</th><th className="text-right">Delivered</th><th className="text-right">Delivery rate</th><th className="text-right">Unmapped</th></tr>
            </thead>
            <tbody>
              {ch.data.map((c) => (
                <tr key={c.courier} className="border-b border-zinc-900">
                  <td className="py-2 capitalize">{c.courier}</td>
                  <td className="text-right">{c.shipments7d}</td>
                  <td className="text-right">{c.delivered7d}</td>
                  <td className="text-right">{c.deliveryRatePct}%</td>
                  <td className="text-right">{c.openUnmappedStatuses > 0 ? <Badge tone="bad">{c.openUnmappedStatuses}</Badge> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AdminLayout>
  );
}
