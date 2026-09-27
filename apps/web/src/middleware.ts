import { NextResponse, type NextRequest } from 'next/server';

/**
 * Gate: if setup incomplete, redirect out to /setup. If the API is unreachable
 * (network error, timeout, non-2xx), fail CLOSED for protected routes by
 * redirecting to /service-unavailable?next=<original>. Public routes (setup,
 * sign-in, the unavailable page itself) still render so the user can recover.
 * Fixes A-M8 (previously fail-open — see plan/security.md item 1).
 */
const API_TIMEOUT_MS = 5000;

function isPublic(pathname: string): boolean {
  return (
    pathname.startsWith('/setup') ||
    pathname.startsWith('/sign-in') ||
    pathname === '/service-unavailable' ||
    pathname === '/_not-found' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

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
    const { state } = (await res.json()) as { state: string };
    if (state !== 'complete') {
      return NextResponse.redirect(new URL('/setup/01-preflight', req.url));
    }
    return NextResponse.next();
  } catch (err) {
    const reason = controller.signal.aborted ? 'timeout' : 'network';
    console.error(`[MW_API_UNREACHABLE:${reason}] ${pathname}`, err);
    return redirectToUnavailable(req, pathname, search);
  } finally {
    clearTimeout(timer);
  }
}

function redirectToUnavailable(req: NextRequest, pathname: string, search: string) {
  const url = new URL('/service-unavailable', req.url);
  url.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
