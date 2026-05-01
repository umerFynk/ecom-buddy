interface Props {
  params: { orderId: string };
}

// Phase 9 will replace this with the full design from BLUEPRINT.md Part 8.
export default function TrackingPage({ params }: Props) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Order #{params.orderId}</h1>
      <p className="text-sm text-gray-500 mb-8 max-w-md">
        The full tracking page (status badge, timeline, purchase details, reseller branding) ships in Phase 9.
      </p>
      <a
        href={(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/v1/orders/' + params.orderId + '/timeline'}
        className="text-sm text-blue-600 underline"
      >
        Raw timeline (dev only)
      </a>
    </main>
  );
}
