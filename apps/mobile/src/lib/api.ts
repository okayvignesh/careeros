import { API_URL } from './config';
import { clearSession, loadSession, saveSession } from './storage';
import type {
  ApprovalsPage,
  BriefLatestRow,
  BriefPreferences,
  DailyBriefPayload,
  JobsListResponse,
  MobileMe,
  MobileSession,
} from './types';

/**
 * Typed client for the Career OS API. The native app authenticates with the
 * `mobile:*` JWT + rotating refresh token minted by `POST /mobile/auth/sign-in`
 * (see apps/api/src/modules/mobile). A global API middleware accepts that
 * bearer on the same read controllers the web app uses, so this client calls
 * `/jobs`, `/me/approvals`, `/brief/*` directly.
 */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

async function rawFetch(
  path: string,
  method: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return `Request failed (${status})`;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status));
  return data as T;
}

interface RefreshResponse {
  deviceId: string;
  jwt: string;
  refreshToken: string;
  expiresAt: string;
}

// Collapse concurrent 401s into one rotation. The server deletes the old
// session row in the same transaction it inserts the new one, so two parallel
// refreshes would make one of them lose the race.
let refreshInFlight: Promise<MobileSession | null> | null = null;

// Set by AuthProvider so a dead session routes the whole app back to sign-in.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

async function refreshSession(current: MobileSession): Promise<MobileSession | null> {
  if (refreshInFlight) return refreshInFlight;
  const pending = (async (): Promise<MobileSession | null> => {
    try {
      const res = await rawFetch(
        '/mobile/auth/refresh',
        'POST',
        { refreshToken: current.refreshToken, deviceId: current.deviceId },
        current.jwt,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as RefreshResponse;
      const next: MobileSession = {
        ...current,
        jwt: data.jwt,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
      };
      await saveSession(next);
      return next;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  refreshInFlight = pending;
  return pending;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  let session = auth ? await loadSession() : null;
  let res = await rawFetch(path, method, body, session?.jwt);
  if (auth && session && res.status === 401) {
    const refreshed = await refreshSession(session);
    if (!refreshed) {
      await clearSession();
      unauthorizedHandler?.();
      throw new ApiError(401, 'Your session expired. Sign in again.');
    }
    session = refreshed;
    res = await rawFetch(path, method, body, session.jwt);
  }
  return parse<T>(res);
}

// --- auth ---

interface SignInResponse extends RefreshResponse {
  userId: string;
  email: string;
}

export interface SignInInput {
  email: string;
  password: string;
  deviceName?: string;
  platform?: string;
}

export async function signIn(input: SignInInput): Promise<MobileSession> {
  const data = await request<SignInResponse>('/mobile/auth/sign-in', {
    method: 'POST',
    body: input,
    auth: false,
  });
  const session: MobileSession = {
    deviceId: data.deviceId,
    userId: data.userId,
    email: data.email,
    jwt: data.jwt,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
  };
  await saveSession(session);
  return session;
}

/** Best-effort server-side revoke, then clear local tokens. */
export async function signOut(): Promise<void> {
  let session = await loadSession();
  if (session) {
    // Rotate first so an expired 1h access token cannot silently skip the
    // server-side revoke. If rotation fails the device is already dead/revoked,
    // so the revoke attempt below is harmless.
    const refreshed = await refreshSession(session);
    if (refreshed) session = refreshed;
    await rawFetch('/mobile/auth/revoke', 'POST', undefined, session.jwt).catch(() => undefined);
  }
  await clearSession();
}

export function getMe(): Promise<MobileMe> {
  return request<MobileMe>('/mobile/me');
}

// --- read-only data ---

export function listJobs(limit = 25, offset = 0): Promise<JobsListResponse> {
  return request<JobsListResponse>(`/jobs?limit=${limit}&offset=${offset}`);
}

export function listApprovals(params: {
  state?: string;
  limit?: number;
  cursor?: string | null;
} = {}): Promise<ApprovalsPage> {
  const query = new URLSearchParams();
  if (params.state) query.set('state', params.state);
  query.set('limit', String(params.limit ?? 25));
  if (params.cursor) query.set('cursor', params.cursor);
  return request<ApprovalsPage>(`/me/approvals?${query.toString()}`);
}

export function getLatestBrief(): Promise<BriefLatestRow[]> {
  return request<BriefLatestRow[]>('/brief/latest?limit=1');
}

/** Compose on demand. Side-effect-free on the server (never persists). */
export function previewBrief(): Promise<DailyBriefPayload> {
  return request<DailyBriefPayload>('/brief/preview', { method: 'POST' });
}

export function getBriefPreferences(): Promise<BriefPreferences | null> {
  return request<BriefPreferences | null>('/brief/preferences');
}
