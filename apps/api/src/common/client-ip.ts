import type { Request } from 'express';

/**
 * Client IP for audit + throttle keys. Uses Express `req.ip`, which honors the
 * `trust proxy` setting configured in main.ts; never read `x-forwarded-for`
 * directly here or a spoofed header wins.
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
