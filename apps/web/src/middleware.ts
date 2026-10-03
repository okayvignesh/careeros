import { NextResponse, type NextRequest } from 'next/server';
import { STATIC_SECURITY_HEADERS, apiOrigin, buildCsp } from '@/lib/security-headers';

/**
 * Gate every request against the API's /setup/state:
 *  - Setup incomplete + non-setup route → redirect to the current wizard step
 *    (or /setup/01-preflight if state is 'not_started').
 *  - Setup incomplete + /setup/<slug> → allow only slugs the user has already
 *    reached (`allowedSlugs`); a URL-jump to a future step 307s back to
 *    `currentStepSlug`. Wave-A hardening (fail closed): unknown slug ==
 *    redirect, no fall-through.
 *  - Setup complete + /setup/* or /sign-in → redirect to /dashboard (the
 *    wizard is done; the sign-in form is redundant when authenticated).
 *  - API unreachable on any protected path → /service-unavailable?next=…
 *    (A-M8: fail closed).
 *
 * It also stamps the security-header baseline (plan/security.md item 2) on
 * every response, minting a per-request CSP nonce and forwarding it to Next as
 * `x-nonce` so the framework can stamp its inline scripts.
 *
 * ponytail: no separate SetupGuard component; the middleware is the single
 * choke point so a page-level bypass isn't possible.
 */
const API_TIMEOUT_MS = 5000;
const SETUP_PREFIX = '/setup/';
const SIGN_IN_PATH = '/sign-in';

interface SetupState {
  state: string;
  hasUser: boolean;
  currentStepSlug: string | null;
  allowedSlugs: readonly string[];
}

function isFrameworkPath(pathname: string): boolean {
  return (
    pathname === '/service-unavailable' ||
    pathname === '/_not-found' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  );
}

function newNonce(): string {
  return btoa(crypto.randomUUID());
}

/** Attach the CSP + static security headers to an outgoing response. */
function decorate(res: NextResponse, nonce: string): NextResponse {
  res.headers.set('Content-Security-Policy', buildCsp(nonce, apiOrigin()));
  for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    res.headers.set(key, value);
  }
  return res;
}

/** Forward the request to the app, carrying the nonce for Next's inline tags. */
function passThrough(req: NextRequest, nonce: string): NextResponse {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', buildCsp(nonce, apiOrigin()));
  return decorate(NextResponse.next({ request: { headers: requestHeaders } }), nonce);
}

function redirectTo(req: NextRequest, location: string, nonce: string): NextResponse {
  return decorate(NextResponse.redirect(new URL(location, req.url)), nonce);
}

export async function middleware(req: NextRequest) {
  const nonce = newNonce();
  const { pathname, search } = req.nextUrl;

  // Next's own API routes (e.g. /api/health) are not part of the setup wizard
  // and manage their own response, so skip the setup-state round-trip.
  if (
    isFrameworkPath(pathname) ||
    pathname === '/api' ||
    pathname.startsWith('/api/')
  ) {
    return passThrough(req, nonce);
  }

  const apiUrl = process.env.API_URL ?? 'http://api:3001';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(`${apiUrl}/setup/state`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[MW_API_UNREACHABLE:status] ${res.status} ${pathname}`);
      return redirectToUnavailable(req, pathname, search, nonce);
    }
    const body = (await res.json()) as SetupState;
    return route(req, pathname, body, nonce);
  } catch (err) {
    const reason = controller.signal.aborted ? 'timeout' : 'network';
    console.error(`[MW_API_UNREACHABLE:${reason}] ${pathname}`, err);
    return redirectToUnavailable(req, pathname, search, nonce);
  } finally {
    clearTimeout(timer);
  }
}

function route(req: NextRequest, pathname: string, body: SetupState, nonce: string): NextResponse {
  const isSetup = pathname.startsWith(SETUP_PREFIX) || pathname === '/setup';
  const isSignIn = pathname === SIGN_IN_PATH;
  const setupComplete = body.state === 'complete';

  // Post-setup: /setup/* and /sign-in redirect to /dashboard so the wizard
  // and login form aren't reachable to an authenticated, done user.
  if (setupComplete && (isSetup || isSignIn)) {
    return redirectTo(req, '/dashboard', nonce);
  }

  // Setup complete + protected route: let the app render.
  if (setupComplete) return passThrough(req, nonce);

  // Setup incomplete: sign-in stays reachable (rare but recoverable). Every
  // other non-setup route sends the user back into the wizard.
  if (isSignIn) return passThrough(req, nonce);

  if (!isSetup) {
    const target = body.currentStepSlug ?? '01-preflight';
    return redirectTo(req, `/setup/${target}`, nonce);
  }

  // Setup incomplete + /setup/<slug>: allow only reached slugs.
  const requestedSlug = pathname.slice(SETUP_PREFIX.length).split('/')[0] ?? '';
  if (!requestedSlug) {
    const target = body.currentStepSlug ?? '01-preflight';
    return redirectTo(req, `/setup/${target}`, nonce);
  }
  if (!body.allowedSlugs.includes(requestedSlug)) {
    const target = body.currentStepSlug ?? '01-preflight';
    return redirectTo(req, `/setup/${target}`, nonce);
  }
  return passThrough(req, nonce);
}

function redirectToUnavailable(
  req: NextRequest,
  pathname: string,
  search: string,
  nonce: string,
): NextResponse {
  const url = new URL('/service-unavailable', req.url);
  url.searchParams.set('next', `${pathname}${search}`);
  return decorate(NextResponse.redirect(url), nonce);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
