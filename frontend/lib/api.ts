/**
 * Backend API klient. JWT tokenni localStorage'dan oladi.
 * Server-side da ham, client-side da ham ishlatish mumkin.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const DEFAULT_TIMEOUT_MS = 15000;

export interface ApiError extends Error {
  status?: number;
  data?: any;
  isTimeout?: boolean;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('xt_token');
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem('xt_token', token);
  else window.localStorage.removeItem('xt_token');
}

export async function apiFetch<T = any>(
  path: string,
  init: RequestInit & { auth?: boolean; timeout?: number } = {},
): Promise<T> {
  const { auth = true, headers, timeout = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json');
  if (auth) {
    const token = getToken();
    if (token) h.set('Authorization', `Bearer ${token}`);
  }

  // Timeout signal — agar backend javob bermasa, abort qilamiz
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const resp = await fetch(`${API_URL}${path}`, { ...rest, headers: h, signal: ctrl.signal });
    clearTimeout(timer);
    const text = await resp.text();
    const data = text ? safeJson(text) : null;
    if (!resp.ok) {
      const err: ApiError = new Error(
        data?.message || data?.error?.message || resp.statusText,
      );
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data as T;
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      const err: ApiError = new Error("Server javob bermayapti — keyinroq urinib ko'ring");
      err.isTimeout = true;
      throw err;
    }
    throw e;
  }
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return s; }
}

export const api = {
  get: <T = any>(path: string, opts?: { timeout?: number }) =>
    apiFetch<T>(path, { method: 'GET', ...opts }),
  post: <T = any>(path: string, body?: any, opts?: { auth?: boolean; timeout?: number }) =>
    apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, ...opts }),
  patch: <T = any>(path: string, body?: any, opts?: { timeout?: number }) =>
    apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined, ...opts }),
  delete: <T = any>(path: string, opts?: { timeout?: number }) =>
    apiFetch<T>(path, { method: 'DELETE', ...opts }),
};
