import { NextResponse, type NextRequest } from 'next/server';

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

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isFrameworkPath(pathname)) return NextResponse.next();

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
      return redirectToUnavailable(req, pathname, search);
    }
    const body = (await res.json()) as SetupState;
    return route(req, pathname, body);
  } catch (err) {
    const reason = controller.signal.aborted ? 'timeout' : 'network';
    console.error(`[MW_API_UNREACHABLE:${reason}] ${pathname}`, err);
    return redirectToUnavailable(req, pathname, search);
  } finally {
    clearTimeout(timer);
  }
}

function route(req: NextRequest, pathname: string, body: SetupState): NextResponse {
  const isSetup = pathname.startsWith(SETUP_PREFIX) || pathname === '/setup';
  const isSignIn = pathname === SIGN_IN_PATH;
  const setupComplete = body.state === 'complete';

  // Post-setup: /setup/* and /sign-in redirect to /dashboard so the wizard
  // and login form aren't reachable to an authenticated, done user.
  if (setupComplete && (isSetup || isSignIn)) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // Setup complete + protected route: let the app render.
  if (setupComplete) return NextResponse.next();

  // Setup incomplete: sign-in stays reachable (rare but recoverable). Every
  // other non-setup route sends the user back into the wizard.
  if (isSignIn) return NextResponse.next();

  if (!isSetup) {
    const target = body.currentStepSlug ?? '01-preflight';
    return NextResponse.redirect(new URL(`/setup/${target}`, req.url));
  }

  // Setup incomplete + /setup/<slug>: allow only reached slugs.
  const requestedSlug = pathname.slice(SETUP_PREFIX.length).split('/')[0] ?? '';
  if (!requestedSlug) {
    const target = body.currentStepSlug ?? '01-preflight';
    return NextResponse.redirect(new URL(`/setup/${target}`, req.url));
  }
  if (!body.allowedSlugs.includes(requestedSlug)) {
    const target = body.currentStepSlug ?? '01-preflight';
    return NextResponse.redirect(new URL(`/setup/${target}`, req.url));
  }
  return NextResponse.next();
}

function redirectToUnavailable(req: NextRequest, pathname: string, search: string) {
  const url = new URL('/service-unavailable', req.url);
  url.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
