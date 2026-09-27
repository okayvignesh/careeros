import { NextResponse, type NextRequest } from 'next/server';

/**
 * If setup incomplete, redirect anything outside /setup and /sign-in to /setup.
 * Falls back gracefully when API is unreachable. The page shows a "waiting" state.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isSetup = pathname.startsWith('/setup');
  const isAuth = pathname.startsWith('/sign-in');
  const isServiceUnavailable = pathname === '/service-unavailable';
  const isNotFound = pathname === '/_not-found';
  const isAsset = pathname.startsWith('/_next') || pathname.startsWith('/favicon');
  if (isSetup || isAuth || isServiceUnavailable || isNotFound || isAsset) return NextResponse.next();

  try {
    const apiUrl = process.env.API_URL ?? 'http://api:3001';
    const res = await fetch(`${apiUrl}/setup/state`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.next();
    const { state } = (await res.json()) as { state: string };
    if (state !== 'complete') {
      return NextResponse.redirect(new URL('/setup/01-preflight', req.url));
    }
    return NextResponse.next();
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
