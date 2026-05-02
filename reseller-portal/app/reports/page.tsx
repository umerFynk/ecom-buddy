'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Spinner, Empty, ErrorBox, fmtPkr } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Product { productId: string; title: string; unitsSold: number; revenuePkr: number; marginPkr: number; returnRatePct: number }
interface Customer { newCount: number; repeatCount: number; topCustomers: Array<{ id: string; name: string | null; phone: string; orders: number; revenuePkr: number; deliveryRatePct: number }>; segments: { excellent: number; good: number; risky: number } }
interface City { city: string; orders: number; delivered: number; rto: number; rtoRatePct: number; revenuePkr: number; netProfitPkr: number }

export default function ReportsPage() {
  const products = useApi<Product[]>('/v1/reports/products');
  const customers = useApi<Customer>('/v1/reports/customers');
  const cities = useApi<City[]>('/v1/reports/cities');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  return (
    <AppLayout>
      <Topbar
        title="Reports"
        subtitle="Last 30 days"
        right={
          <div className="flex gap-2">
            <a href={`${apiUrl}/v1/reports/export/orders-csv`} className="text-xs text-brand hover:underline">Orders CSV</a>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="text-sm text-zinc-400 mb-3">Top products</div>
          {products.loading && <Spinner />}
          {products.data && products.data.length === 0 && <Empty title="No product sales yet" />}
          {products.data && products.data.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500 border-b border-zinc-800">
                <tr><th className="py-2">Product</th><th className="text-right">Units</th><th className="text-right">Revenue</th><th className="text-right">Return rate</th></tr>
              </thead>
              <tbody>
                {products.data.slice(0, 15).map((p) => (
                  <tr key={p.productId} className="border-b border-zinc-900">
                    <td className="py-2">{p.title}</td>
                    <td className="text-right">{p.unitsSold}</td>
                    <td className="text-right">{fmtPkr(p.revenuePkr)}</td>
                    <td className="text-right">{p.returnRatePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <div className="text-sm text-zinc-400 mb-3">Customers</div>
          {customers.loading && <Spinner />}
          {customers.error && <ErrorBox error={customers.error} />}
          {customers.data && (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div><div className="text-xs text-zinc-500">New</div><div className="text-2xl font-semibold text-white">{customers.data.newCount}</div></div>
                <div><div className="text-xs text-zinc-500">Repeat</div><div className="text-2xl font-semibold text-white">{customers.data.repeatCount}</div></div>
                <div><div className="text-xs text-zinc-500">Excellent</div><div className="text-2xl font-semibold text-emerald-400">{customers.data.segments.excellent}</div></div>
              </div>
              {customers.data.topCustomers.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="text-left text-zinc-500 border-b border-zinc-800">
                    <tr><th className="py-2">Customer</th><th>Orders</th><th className="text-right">Revenue</th></tr>
                  </thead>
                  <tbody>
                    {customers.data.topCustomers.slice(0, 10).map((c) => (
                      <tr key={c.id} className="border-b border-zinc-900">
                        <td className="py-2">{c.name ?? c.phone}</td>
                        <td>{c.orders}</td>
                        <td className="text-right">{fmtPkr(c.revenuePkr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <div className="text-sm text-zinc-400 mb-3">City breakdown</div>
        {cities.loading && <Spinner />}
        {cities.data && cities.data.length === 0 && <Empty title="No city data yet" />}
        {cities.data && cities.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">City</th><th className="text-right">Orders</th><th className="text-right">Delivered</th><th className="text-right">RTO rate</th><th className="text-right">Revenue</th><th className="text-right">Net profit</th></tr>
            </thead>
            <tbody>
              {cities.data.map((c) => (
                <tr key={c.city} className="border-b border-zinc-900">
                  <td className="py-2">{c.city}</td>
                  <td className="text-right">{c.orders}</td>
                  <td className="text-right">{c.delivered}</td>
                  <td className="text-right">{c.rtoRatePct}%</td>
                  <td className="text-right">{fmtPkr(c.revenuePkr)}</td>
                  <td className="text-right">{fmtPkr(c.netProfitPkr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}
