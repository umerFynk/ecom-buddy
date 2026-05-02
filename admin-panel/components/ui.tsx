'use client';

import { ReactNode, ButtonHTMLAttributes, forwardRef } from 'react';

export function Card(props: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-zinc-800 bg-zinc-950 p-4 ${props.className ?? ''}`}>{props.children}</div>;
}
export function StatCard(props: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-zinc-500">{props.label}</div>
      <div className="text-3xl font-semibold mt-1 text-white">{props.value}</div>
      {props.hint && <div className="text-xs text-zinc-500 mt-1">{props.hint}</div>}
    </Card>
  );
}
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }>((props, ref) => {
  const { variant = 'primary', className, ...rest } = props;
  const base = 'inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition disabled:opacity-50';
  const v = variant === 'ghost' ? 'border border-zinc-700 text-zinc-200 hover:bg-zinc-900' : variant === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-brand hover:bg-brand-dark text-white';
  return <button ref={ref} className={`${base} ${v} ${className ?? ''}`} {...rest} />;
});
Button.displayName = 'Button';
export function Badge(props: { children: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' | 'info' }) {
  const cls = {
    default: 'bg-zinc-800 text-zinc-200', good: 'bg-emerald-900/40 text-emerald-300',
    bad: 'bg-red-900/40 text-red-300', warn: 'bg-amber-900/40 text-amber-300', info: 'bg-blue-900/40 text-blue-300',
  }[props.tone ?? 'default'];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${cls}`}>{props.children}</span>;
}
export function Spinner() { return <div className="text-sm text-zinc-500">Loading…</div>; }
export function Empty(props: { title: string; hint?: string }) {
  return <div className="text-center py-12 text-zinc-500"><div className="text-zinc-300 font-medium">{props.title}</div>{props.hint && <div className="text-sm mt-1">{props.hint}</div>}</div>;
}
export function ErrorBox(props: { error: string | null }) {
  if (!props.error) return null;
  return <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{props.error}</div>;
}
export function fmtPkr(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : (n ?? 0);
  return `Rs ${(v ?? 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return (typeof d === 'string' ? new Date(d) : d).toISOString().slice(0, 10);
}
