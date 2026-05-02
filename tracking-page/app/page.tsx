export default function Landing() {
  const portal = process.env.NEXT_PUBLIC_RESELLER_URL ?? 'http://localhost:3000';
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="text-xl font-bold text-sky-600">Ecom Buddy</div>
          <nav className="flex gap-4 text-sm">
            <a href="#features" className="text-gray-600 hover:text-gray-900">Features</a>
            <a href="#pricing" className="text-gray-600 hover:text-gray-900">Pricing</a>
            <a href={`${portal}/login`} className="text-gray-600 hover:text-gray-900">Sign in</a>
            <a href={`${portal}/signup`} className="bg-sky-600 text-white px-4 py-1.5 rounded">Start free</a>
          </nav>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight">The complete e-commerce OS for Pakistani sellers.</h1>
        <p className="mt-6 text-lg text-gray-600 max-w-2xl mx-auto">
          OMS, WMS, 3PL, WhatsApp comms, AI assistant, and Financify in one platform. Stop stitching tools — ship faster, lose fewer COD orders.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <a href={`${portal}/signup`} className="bg-sky-600 hover:bg-sky-700 text-white px-6 py-3 rounded-md font-medium">Start your 14-day trial</a>
          <a href="#features" className="border border-gray-300 px-6 py-3 rounded-md font-medium">See features</a>
        </div>
      </section>

      <section id="features" className="bg-gray-50 border-y border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-20 grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white rounded-lg p-6 border border-gray-200">
              <div className="text-2xl">{f.emoji}</div>
              <h3 className="font-semibold mt-3">{f.title}</h3>
              <p className="text-sm text-gray-600 mt-1">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-10">Pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((p) => (
            <div key={p.name} className={`rounded-lg p-6 border ${p.highlight ? 'border-sky-500 ring-2 ring-sky-200' : 'border-gray-200'}`}>
              <div className="text-sm uppercase tracking-wider text-gray-500">{p.name}</div>
              <div className="text-3xl font-bold mt-2">Rs {p.price.toLocaleString()}<span className="text-base font-normal text-gray-500">/mo</span></div>
              <ul className="mt-4 space-y-1.5 text-sm text-gray-700">
                {p.features.map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              <a href={`${portal}/signup`} className={`mt-6 block text-center px-4 py-2 rounded-md font-medium ${p.highlight ? 'bg-sky-600 text-white' : 'border border-gray-300'}`}>Start free</a>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-8 text-center text-sm text-gray-500">© Ecom Buddy</div>
      </footer>
    </div>
  );
}

const FEATURES = [
  { emoji: '📦', title: 'Multi-courier OMS', body: 'PostEx, Leopards, Trax, BlueEx, MNX, CallCourier — auto-assignment with city overrides + failover.' },
  { emoji: '💬', title: 'WhatsApp confirmations', body: '5 confirmation paths, OTP for high-risk, Roman Urdu replies parsed automatically.' },
  { emoji: '🤖', title: 'AI risk engine', body: 'GPT-4o decides which orders to confirm, OTP, hold for CS, or auto-cancel — trained on Pakistani COD data.' },
  { emoji: '🏦', title: 'Financify P&L', body: 'Per-order net profit, COD reconciliation across all 6 couriers, cash + accrual modes.' },
  { emoji: '🏢', title: 'WMS + 3PL', body: 'Send stock to our warehouse and we pick, pack, dispatch — or use it for your own warehouse.' },
  { emoji: '🔌', title: 'Public REST API + webhooks', body: 'Build your own automations. HMAC-signed webhooks, OpenAPI spec, fair rate limits.' },
];

const PLANS = [
  { name: 'Starter', price: 0, highlight: false, features: ['Up to 200 orders/mo', 'Shared WhatsApp number', '1,000 API calls/hr', 'All couriers', 'P&L + reports'] },
  { name: 'Growth', price: 9999, highlight: true, features: ['Unlimited orders', 'Your own WhatsApp number', '2,000 API calls/hr', 'Outgoing webhooks', 'Account manager'] },
  { name: 'Scale', price: 24999, highlight: false, features: ['Unlimited orders', '5,000 API calls/hr', 'Custom tracking domain', 'Priority support', 'White-label tracking page'] },
];
