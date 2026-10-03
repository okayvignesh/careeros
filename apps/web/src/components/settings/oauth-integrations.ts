// Pure helpers for the OAuth-backed Slack + Gmail integration cards. Kept out
// of the JSX so the connect wiring, the `?connected=` return handling, and the
// status mapping run in the node vitest suite (no jsdom, matching
// gitlab-connect.ts).

export interface IntegrationRow {
  kind: string;
  status: string;
  connectedAt: string;
  metadata: Record<string, unknown> | null;
}

export type OAuthKind = 'slack' | 'gmail';

/** Auth-required `.../oauth/start` endpoints that mint the provider URL. */
const START_PATH: Record<OAuthKind, string> = {
  slack: '/webhooks/slack/oauth/start',
  gmail: '/integrations/gmail/oauth/start',
};

export function oauthStartPath(kind: OAuthKind): string {
  return START_PATH[kind];
}

export interface OAuthStartDeps {
  /** `apiGet`-shaped loader. Returns the provider authorize URL. */
  loadUrl: (path: string) => Promise<{ url: string }>;
  /** Hand the browser to the provider (e.g. `window.location.assign`). */
  navigate: (url: string) => void;
}

/**
 * Ask the API for the provider's authorize URL and hand the browser to it.
 * Kept as an injected-deps seam so the connect wiring is testable without a
 * DOM; the API's `{ message }` errors (e.g. `slack oauth not configured`)
 * propagate verbatim for the card to display.
 */
export async function beginOAuth(kind: OAuthKind, deps: OAuthStartDeps): Promise<void> {
  const { url } = await deps.loadUrl(oauthStartPath(kind));
  deps.navigate(url);
}

/**
 * The provider callbacks 302 back to `/settings/integrations?connected=<kind>`
 * on success. Anything other than the two known kinds is ignored.
 */
export function parseConnectedParam(value: string | null | undefined): OAuthKind | null {
  return value === 'slack' || value === 'gmail' ? value : null;
}

export interface GmailWatch {
  historyId: string | null;
  expiration: string | null;
}

/**
 * Defensive read of the Gmail watch pointer. `GET /integrations` currently
 * persists `metadata: {}` for Gmail (the historyId/expiration live in the
 * `gmail_watches` table, which no endpoint exposes yet), so this returns null
 * today and renders nothing rather than inventing a value. It lights up for
 * free if/when the API copies those fields onto the row.
 */
export function gmailWatchFromRow(row: IntegrationRow | null): GmailWatch | null {
  if (!row || row.status !== 'connected') return null;
  const meta = row.metadata ?? {};
  const historyId = typeof meta.historyId === 'string' ? meta.historyId : null;
  const expiration = typeof meta.expiration === 'string' ? meta.expiration : null;
  if (!historyId && !expiration) return null;
  return { historyId, expiration };
}
