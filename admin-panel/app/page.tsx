import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <span className="uppercase tracking-widest text-xs text-zinc-500 mb-4">Internal</span>
      <h1 className="text-5xl font-bold text-white mb-3">Ecom Buddy Admin</h1>
      <p className="text-zinc-400 max-w-md mb-8">Phase 1 placeholder. Full panel arrives in Phase 7 / 9.</p>
      <Link
        href="/login"
        className="rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark transition"
      >
        Admin login
      </Link>
    </main>
  );
}
