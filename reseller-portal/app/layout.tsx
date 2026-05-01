import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ecom Buddy — Reseller Portal',
  description: 'Manage orders, inventory, couriers, finances, and customer comms.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
