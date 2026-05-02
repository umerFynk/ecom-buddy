'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthed } from '@/lib/auth';

export function AuthGuard(props: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login');
  }, [router]);
  return <>{props.children}</>;
}
