'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Topbar } from '@/components/Topbar';
import { Card, Button, Input, ErrorBox } from '@/components/ui';
import { useApiMutation } from '@/lib/useApi';
import { useRouter } from 'next/navigation';

const STEPS = ['Store info', 'Shopify', 'Couriers', 'WhatsApp', 'Go live'];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const router = useRouter();
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <AppLayout>
      <Topbar title="Onboarding" subtitle="Get your store live in 5 quick steps" />
      <div className="flex items-center gap-3 mb-6">
        {STEPS.map((label, i) => (
          <div key={i} className="flex-1 flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full text-xs flex items-center justify-center ${i <= step ? 'bg-brand text-white' : 'bg-zinc-800 text-zinc-500'}`}>{i + 1}</div>
            <span className={`text-sm ${i <= step ? 'text-white' : 'text-zinc-500'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? 'bg-brand' : 'bg-zinc-800'}`} />}
          </div>
        ))}
      </div>

      <Card>
        {step === 0 && <StoreInfoStep onNext={next} />}
        {step === 1 && <ShopifyStep onNext={next} onBack={back} />}
        {step === 2 && <CouriersStep onNext={next} onBack={back} />}
        {step === 3 && <WhatsAppStep onNext={next} onBack={back} />}
        {step === 4 && <GoLiveStep onBack={back} onDone={() => router.push('/dashboard')} />}
      </Card>
    </AppLayout>
  );
}

function StoreInfoStep(props: { onNext: () => void }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Store info</h2>
      <p className="text-sm text-zinc-400">Confirm the basics. You can edit any of this later in Settings → Stores.</p>
      <Input value="" onChange={() => {}} placeholder="Store name (already set on signup)" />
      <Input value="Asia/Karachi" onChange={() => {}} placeholder="Timezone" />
      <div className="flex justify-end"><Button onClick={props.onNext}>Continue →</Button></div>
    </div>
  );
}

function ShopifyStep(props: { onNext: () => void; onBack: () => void }) {
  const [shop, setShop] = useState('');
  const mut = useApiMutation<{ redirectUrl: string }>();

  async function connect() {
    // We call the existing OAuth install endpoint; require an existing store id.
    const stores = (await (await fetch((process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/v1/stores', { headers: { Authorization: `Bearer ${localStorage.getItem('eb_token')}` } })).json()).data ?? [];
    const storeId = stores[0]?.id;
    if (!storeId) return;
    const r = await mut.mutate('POST', '/v1/shopify/install', { storeId, shopDomain: shop });
    if (r?.redirectUrl) window.location.href = r.redirectUrl;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Connect Shopify</h2>
      <p className="text-sm text-zinc-400">Enter your Shopify store domain to begin OAuth. We sync orders, products, and inventory.</p>
      <Input value={shop} onChange={setShop} placeholder="yourstore.myshopify.com" />
      <ErrorBox error={mut.error} />
      <div className="flex justify-between">
        <Button variant="ghost" onClick={props.onBack}>← Back</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={props.onNext}>Skip for now</Button>
          <Button onClick={connect} disabled={mut.loading || !shop.includes('.myshopify.com')}>Connect & continue</Button>
        </div>
      </div>
    </div>
  );
}

function CouriersStep(props: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Connect couriers</h2>
      <p className="text-sm text-zinc-400">Add at least one courier so we can book shipments. You can add more later in Settings → Couriers.</p>
      <ul className="text-sm text-zinc-300 list-disc pl-5">
        <li>PostEx — fastest network in major metros</li>
        <li>Leopards — broad PK coverage</li>
        <li>Trax / BlueEx / MNX / CallCourier — broaden geography</li>
      </ul>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={props.onBack}>← Back</Button>
        <div className="flex gap-2">
          <a href="/couriers" className="text-sm text-brand hover:underline self-center">Open Couriers →</a>
          <Button onClick={props.onNext}>Continue →</Button>
        </div>
      </div>
    </div>
  );
}

function WhatsAppStep(props: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">WhatsApp</h2>
      <p className="text-sm text-zinc-400">On Starter plan we use the Ecom Buddy shared customer-comms WA number. Upgrade to Growth to use your own 360dialog number.</p>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={props.onBack}>← Back</Button>
        <Button onClick={props.onNext}>Continue →</Button>
      </div>
    </div>
  );
}

function GoLiveStep(props: { onBack: () => void; onDone: () => void }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">You&apos;re live 🎉</h2>
      <p className="text-sm text-zinc-400">All set. New Shopify orders will start flowing in within a minute. Your dashboard will update in real time.</p>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={props.onBack}>← Back</Button>
        <Button onClick={props.onDone}>Open dashboard →</Button>
      </div>
    </div>
  );
}
