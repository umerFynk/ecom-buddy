import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <span className="uppercase tracking-widest text-xs text-zinc-500 mb-4">Reseller Portal</span>
      <h1 className="text-5xl font-bold text-white mb-3">Ecom Buddy</h1>
      <p className="text-zinc-400 max-w-md mb-8">
        Phase 1 backend is live. The full dashboard arrives in Phase 9.
      </p>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark transition"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-md border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900 transition"
        >
          Create account
        </Link>
      </div>
      <p className="mt-12 text-xs text-zinc-600">
        API: <code>{process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}</code>
      </p>
    </main>
  );
}
