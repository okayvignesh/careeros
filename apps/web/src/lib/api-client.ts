const SERVER_API_URL = process.env.API_URL ?? 'http://api:3001';
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const baseUrl = (): string => (typeof window === 'undefined' ? SERVER_API_URL : BROWSER_API_URL);

/** Full URL for direct browser navigation to a stream endpoint (e.g. PDF download). */
export function apiBrowserUrl(path: string): string {
  return `${BROWSER_API_URL}${path}`;
}

/**
 * A-H1 (client-side): the server sets a non-HttpOnly `__Host-careeros_csrf`
 * (prod) / `careeros_csrf` (dev) cookie alongside the session. Non-GET
 * requests from the SPA must echo that value in the `x-csrf-token` header
 * (double-submit). ponytail: dev+prod names checked; no env branch needed.
 * Exported so tests can drive it directly.
 * ponytail: RSC / Server Actions issue their own fetch server-side and don't
 * hit this wrapper; they'll need cookie forwarding wired separately once
 * added. No Server Actions in the app today.
 */
export function readCsrfTokenFromCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === '__Host-careeros_csrf' || rawName === 'careeros_csrf') {
      return rest.join('=') || null;
    }
  }
  return null;
}

/** Non-2xx response. Carries the status so callers can distinguish 404 from a real failure. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (method !== 'GET' && typeof document !== 'undefined') {
    const token = readCsrfTokenFromCookie(document.cookie ?? '');
    if (token) headers['x-csrf-token'] = token;
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    credentials: 'include',
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg = (data as { message?: string } | null)?.message ?? `${method} ${path} → ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>('GET', path, undefined, init);
}
export function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>('POST', path, body, init);
}
export function apiPut<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>('PUT', path, body, init);
}
export function apiPatch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>('PATCH', path, body, init);
}
export function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>('DELETE', path, undefined, init);
}
