import { NextResponse } from 'next/server';

/**
 * Web-tier liveness. In production nginx routes `/api/*` straight to the API,
 * so the public `/api/health` is the API's. This handler keeps the web tier's
 * own health check reachable when it is hit directly (dev / no reverse proxy)
 * and lets the security-header e2e assert the full set on the literal path.
 */
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
