// Pure helpers for the GitLab integration card. Kept separate from the JSX so
// the self-hosted opt-in gate and the connect payload mapping can be tested in
// the node vitest run (no jsdom).
//
// The API stores the configured host inside `Integration.baseUrl` (null for
// gitlab.com) but `GET /integrations` only returns `{ kind, status,
// connectedAt, metadata }`. The saved GitLab profile carries `webUrl`
// (`https://gitlab.com/<user>` or `https://<self-hosted>/<user>`), which is the
// real signal we can read for the row's host without changing the API.

export const GITLAB_DEFAULT_HOST = 'gitlab.com';
export const GITLAB_MIN_PAT_LENGTH = 20;

export interface GitlabRow {
  kind: string;
  status: string;
  connectedAt: string;
  metadata: Record<string, unknown> | null;
  /** Present if the integrations list ever exposes it; today it does not. */
  baseUrl?: string | null;
}

export interface GitlabConnectFormState {
  pat: string;
  baseUrl: string;
  allowlistOptIn: boolean;
}

export interface GitlabConnectPayload {
  pat: string;
  baseUrl?: string;
  allowlistOptIn?: boolean;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Lowercased hostname for an absolute URL, or null when empty/unparseable. */
export function hostFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Configured host for a connected GitLab row, derived from stored metadata. */
export function gitlabHostFromRow(row: GitlabRow | null): string | null {
  if (!row) return null;
  const meta = row.metadata ?? {};
  return (
    hostFromUrl(asString(row.baseUrl)) ??
    hostFromUrl(asString(meta.baseUrl)) ??
    hostFromUrl(asString(meta.webUrl) ?? asString(meta.web_url))
  );
}

export function isSelfHostedHost(host: string | null): boolean {
  return host !== null && host !== GITLAB_DEFAULT_HOST;
}

/**
 * `protocol//host[:port]` for the row's configured host, if any. Used to
 * prefill the base-url field on reauth so rotating a PAT cannot silently
 * downgrade a self-hosted integration back to gitlab.com.
 */
export function gitlabBaseUrlFromRow(row: GitlabRow | null): string | null {
  if (!row) return null;
  const meta = row.metadata ?? {};
  const raw =
    asString(row.baseUrl) ??
    asString(meta.baseUrl) ??
    asString(meta.webUrl) ??
    asString(meta.web_url);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * True only when a *parseable* non-gitlab.com host was entered. Empty or
 * malformed input is left to the API (it owns the SSRF/validation reject), so
 * we do not pre-empt its error message.
 */
export function needsAllowlistOptIn(baseUrl: string): boolean {
  return isSelfHostedHost(hostFromUrl(baseUrl.trim()));
}

/**
 * Client-side mirror of the two gates the API will enforce before persisting:
 * the PAT length floor and the per-user self-hosted allowlist opt-in. Returns
 * null when the form may be submitted.
 */
export function connectBlockedReason(form: GitlabConnectFormState): string | null {
  if (form.pat.trim().length < GITLAB_MIN_PAT_LENGTH) {
    return `Personal access token must be at least ${GITLAB_MIN_PAT_LENGTH} characters.`;
  }
  if (needsAllowlistOptIn(form.baseUrl) && !form.allowlistOptIn) {
    return 'Tick the self-hosted confirmation to continue.';
  }
  return null;
}

/**
 * Maps the card's form state onto `POST /integrations/gitlab/connect`.
 * `baseUrl` is omitted (not sent as empty) when blank so the server defaults to
 * gitlab.com. `allowlistOptIn` is only sent when it is actually required.
 */
export function buildGitlabConnectPayload(form: GitlabConnectFormState): GitlabConnectPayload {
  const baseUrl = form.baseUrl.trim();
  const payload: GitlabConnectPayload = { pat: form.pat.trim() };
  if (baseUrl) payload.baseUrl = baseUrl;
  if (needsAllowlistOptIn(baseUrl)) payload.allowlistOptIn = true;
  return payload;
}
