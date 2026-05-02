'use client';

import { ReactNode, ButtonHTMLAttributes, forwardRef } from 'react';

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-950 p-4 ${props.className ?? ''}`}>{props.children}</div>
  );
}

export function StatCard(props: { label: string; value: string | number; hint?: string; tone?: 'default' | 'good' | 'bad' | 'warn' | 'info' }) {
  const toneCls = props.tone === 'good' ? 'text-emerald-400' : props.tone === 'bad' ? 'text-red-400' : props.tone === 'warn' ? 'text-amber-400' : props.tone === 'info' ? 'text-blue-400' : 'text-white';
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-zinc-500">{props.label}</div>
      <div className={`text-3xl font-semibold mt-1 ${toneCls}`}>{props.value}</div>
      {props.hint && <div className="text-xs text-zinc-500 mt-1">{props.hint}</div>}
    </Card>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }>((props, ref) => {
  const { variant = 'primary', className, ...rest } = props;
  const base = 'inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
  const v = variant === 'ghost'
    ? 'border border-zinc-700 text-zinc-200 hover:bg-zinc-900'
    : variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-brand hover:bg-brand-dark text-white';
  return <button ref={ref} className={`${base} ${v} ${className ?? ''}`} {...rest} />;
});
Button.displayName = 'Button';

export function Input(props: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string }) {
  return (
    <input
      type={props.type ?? 'text'}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className={`w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand ${props.className ?? ''}`}
    />
  );
}

export function Select(props: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; className?: string }) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className={`rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm ${props.className ?? ''}`}
    >
      {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Badge(props: { children: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' | 'info' }) {
  const tone = props.tone ?? 'default';
  const cls = {
    default: 'bg-zinc-800 text-zinc-200',
    good: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
    bad: 'bg-red-900/40 text-red-300 border-red-800',
    warn: 'bg-amber-900/40 text-amber-300 border-amber-800',
    info: 'bg-blue-900/40 text-blue-300 border-blue-800',
  }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border border-transparent ${cls}`}>{props.children}</span>;
}

const STATUS_TONE: Record<string, 'default' | 'good' | 'bad' | 'warn' | 'info'> = {
  new: 'default',
  pending_confirmation: 'warn',
  confirmed: 'good',
  auto_confirmed: 'good',
  inventory_allocated: 'info',
  courier_booked: 'info',
  dispatched: 'info',
  in_transit: 'info',
  out_for_delivery: 'info',
  delivered: 'good',
  partially_delivered: 'good',
  failed_delivery: 'warn',
  rto_initiated: 'bad',
  rto_in_transit: 'bad',
  rto_returned: 'bad',
  cancelled_by_seller: 'default',
  cancelled_no_response: 'default',
  cancelled_fake: 'bad',
  cancelled_by_customer: 'default',
  cancelled_by_courier: 'default',
  unconfirmed_shipped: 'warn',
  on_hold: 'warn',
  unknown: 'bad',
};

export function StatusPill(props: { status: string }) {
  return <Badge tone={STATUS_TONE[props.status] ?? 'default'}>{props.status.replace(/_/g, ' ')}</Badge>;
}

export function Empty(props: { title: string; hint?: string }) {
  return (
    <div className="text-center py-12 text-zinc-500">
      <div className="text-zinc-300 font-medium">{props.title}</div>
      {props.hint && <div className="text-sm mt-1">{props.hint}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="text-sm text-zinc-500">Loading…</div>;
}

export function Modal(props: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={props.onClose}>
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-lg p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{props.title}</h2>
          <button onClick={props.onClose} className="text-zinc-500 hover:text-white">✕</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function ErrorBox(props: { error: string | null }) {
  if (!props.error) return null;
  return <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{props.error}</div>;
}

export function fmtPkr(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : (n ?? 0);
  if (!Number.isFinite(v)) return 'Rs 0';
  return `Rs ${v.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}

export function fmtDateShort(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const x = typeof d === 'string' ? new Date(d) : d;
  return x.toISOString().slice(0, 10);
}
