'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from './api';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useApi<T = unknown>(url: string, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(url);
      setData(res.data?.data ?? null);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error
        ?? (e as { message?: string }).message
        ?? 'Request failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => { void fetcher(); }, [fetcher]);

  return { data, loading, error, refetch: fetcher };
}

export function useApiMutation<T = unknown>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(async (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.request({ method, url, data: body });
      return res.data?.data ?? null;
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error
        ?? (e as { message?: string }).message
        ?? 'Request failed';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { mutate, loading, error };
}
