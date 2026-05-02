'use client';

const KEY = 'eb_admin_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
}
export function setToken(t: string) { localStorage.setItem(KEY, t); }
export function clearToken() { localStorage.removeItem(KEY); }
export function isAuthed(): boolean { return Boolean(getToken()); }
