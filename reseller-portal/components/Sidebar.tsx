'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearToken } from '@/lib/auth';

const TABS: Array<{ href: string; label: string; group?: string }> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/orders', label: 'Orders' },
  { href: '/shipments', label: 'Shipments' },
  { href: '/confirmation', label: 'Confirmation' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/couriers', label: 'Couriers' },
  { href: '/rto', label: 'RTO Rescue' },
  { href: '/messaging', label: 'Messaging' },
  { href: '/financify', label: 'Financify' },
  { href: '/reports', label: 'Reports' },
  { href: '/automations', label: 'Automations' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/support', label: 'Support' },
  { href: '/ai', label: 'AI Assistant' },
  { href: '/wms', label: 'WMS', group: '3PL' },
  { href: '/settings', label: 'Settings' },
];

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  return (
    <aside className="w-56 shrink-0 border-r border-zinc-900 bg-black/40 min-h-screen flex flex-col">
      <div className="p-4 border-b border-zinc-900">
        <Link href="/dashboard" className="text-white font-semibold">Ecom Buddy</Link>
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {TABS.map((t) => {
          const active = path?.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href as never}
              className={`block px-3 py-1.5 rounded text-sm ${active ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60'}`}
            >
              {t.label}
              {t.group && <span className="ml-2 text-xs text-zinc-600">{t.group}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-zinc-900">
        <button
          onClick={() => { clearToken(); router.push('/login'); }}
          className="w-full text-left text-xs text-zinc-500 hover:text-red-300"
        >Sign out</button>
      </div>
    </aside>
  );
}
