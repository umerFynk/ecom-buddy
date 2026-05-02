'use client';

import { ReactNode } from 'react';

export function Topbar(props: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{props.title}</h1>
        {props.subtitle && <p className="text-sm text-zinc-500 mt-0.5">{props.subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{props.right}</div>
    </div>
  );
}
