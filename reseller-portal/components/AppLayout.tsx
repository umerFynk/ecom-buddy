'use client';

import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { AuthGuard } from './AuthGuard';

export function AppLayout(props: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 p-8 overflow-x-auto">{props.children}</main>
      </div>
    </AuthGuard>
  );
}
