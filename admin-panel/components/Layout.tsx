'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { clearToken, isAuthed } from '@/lib/auth';

const TABS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/resellers', label: 'Resellers' },
  { href: '/status-manager', label: 'Status Manager' },
  { href: '/blacklist', label: 'Global Blacklist' },
  { href: '/cs-inbox', label: 'CS Inbox' },
  { href: '/b2b', label: 'B2B Inbox' },
  { href: '/support', label: 'Support tickets' },
  { href: '/internal-chat', label: 'Internal chat' },
  { href: '/warehouse', label: 'Warehouse' },
  { href: '/platform-config', label: 'Platform config' },
];

export function AdminLayout(props: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();

  useEffect(() => { if (!isAuthed()) router.replace('/login'); }, [router]);

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-zinc-900 bg-black/40 min-h-screen flex flex-col">
        <div className="p-4 border-b border-zinc-900"><Link href="/dashboard" className="text-white font-semibold">Ecom Buddy Admin</Link></div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {TABS.map((t) => {
            const active = path?.startsWith(t.href);
            return <Link key={t.href} href={t.href as never} className={`block px-3 py-1.5 rounded text-sm ${active ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60'}`}>{t.label}</Link>;
          })}
        </nav>
        <div className="p-3 border-t border-zinc-900">
          <button onClick={() => { clearToken(); router.push('/login'); }} className="w-full text-left text-xs text-zinc-500 hover:text-red-300">Sign out</button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-x-auto">{props.children}</main>
    </div>
  );
}
