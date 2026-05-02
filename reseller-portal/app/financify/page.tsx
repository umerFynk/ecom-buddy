'use client';

import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, StatCard, Spinner, ErrorBox, fmtPkr, fmtDateShort, Empty } from '@/components/ui';
import { useApi } from '@/lib/useApi';

interface Pnl {
  range: { startDate: string; endDate: string };
  recognizedRevenue: number; cogs: number; courierFees: number; codFees: number;
  waCost: number; rtoLoss: number; returnShipping: number; netProfit: number; marginPct: number; orderCount: number;
}

interface Stmt { id: string; courierType: string; invoiceDate: string; netPayable: string; status: string; pdfUrl?: string | null }

export default function FinancifyPage() {
  const pnl = useApi<Pnl>('/v1/reports/pnl');
  const stmts = useApi<Stmt[]>('/v1/financify/cod-statements');

  return (
    <AppLayout>
      <Topbar title="Financify" subtitle="P&L, COD statements, reconciliation" />

      {pnl.loading && <Spinner />}
      {pnl.error && <ErrorBox error={pnl.error} />}
      {pnl.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Recognized revenue" value={fmtPkr(pnl.data.recognizedRevenue)} tone="good" />
          <StatCard label="COGS" value={fmtPkr(pnl.data.cogs)} />
          <StatCard label="Net profit" value={fmtPkr(pnl.data.netProfit)} tone="good" />
          <StatCard label="Margin" value={`${pnl.data.marginPct}%`} tone="good" />
          <StatCard label="Courier fees" value={fmtPkr(pnl.data.courierFees)} />
          <StatCard label="COD fees" value={fmtPkr(pnl.data.codFees)} />
          <StatCard label="WA cost" value={fmtPkr(pnl.data.waCost)} />
          <StatCard label="RTO loss" value={fmtPkr(pnl.data.rtoLoss)} tone="bad" />
        </div>
      )}

      <Card>
        <div className="text-sm text-zinc-400 mb-3">COD statements</div>
        {stmts.loading && <Spinner />}
        {stmts.data && stmts.data.length === 0 && <Empty title="No COD statements yet" hint="Generate one from the courier remittance window." />}
        {stmts.data && stmts.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500 border-b border-zinc-800">
              <tr><th className="py-2">Courier</th><th>Invoice date</th><th className="text-right">Net payable</th><th>Status</th><th>PDF</th></tr>
            </thead>
            <tbody>
              {stmts.data.map((s) => (
                <tr key={s.id} className="border-b border-zinc-900">
                  <td className="py-2 capitalize">{s.courierType}</td>
                  <td>{fmtDateShort(s.invoiceDate)}</td>
                  <td className="text-right">{fmtPkr(s.netPayable)}</td>
                  <td className="text-xs text-zinc-400">{s.status}</td>
                  <td>{s.pdfUrl && <a href={(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + s.pdfUrl} target="_blank" rel="noreferrer" className="text-brand text-xs hover:underline">Open</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppLayout>
  );
}
