const SERVER_API_URL = process.env.API_URL ?? 'http://api:3001';
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const baseUrl = (): string => (typeof window === 'undefined' ? SERVER_API_URL : BROWSER_API_URL);

/** Full URL for direct browser navigation to a stream endpoint (e.g. PDF download). */
export function apiBrowserUrl(path: string): string {
  return `${BROWSER_API_URL}${path}`;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    method,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    credentials: 'include',
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg = (data as { message?: string } | null)?.message ?? `${method} ${path} → ${res.status}`;
    throw new Error(msg);
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
