import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * C-P4.8 / Rule 4: pino redaction paths. Kept next to the request-id
 * middleware so tests can import both without pulling in the whole
 * Nest module graph.
 *
 * Covers: password, token, apiKey, authorization, secret, x-api-key,
 * x-csrf-token, cookie, plus email (PII). Wildcards catch nested
 * objects loggers pass in.
 */
export const REDACTION_PATHS = [
  // Request headers that carry credentials or CSRF material.
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  // Request bodies for known secret-carrying endpoints.
  'req.body.password',
  'req.body.apiKey',
  'req.body.apikey',
  'req.body.token',
  'req.body.access_token',
  'req.body.refresh_token',
  'req.body.client_secret',
  'req.body.secretKey',
  'req.body.secret',
  'req.body.ciphertext',
  'req.body.email',
  // One-level wildcards for internal objects passed to loggers.
  '*.password',
  '*.apiKey',
  '*.apikey',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.authorization',
  '*.client_secret',
  '*.secretKey',
  '*.secret',
  '*.ciphertext',
  '*.cookie',
  '*.email',
];

/**
 * C-P4.8: give every request a stable id, propagate it back on the response,
 * and expose it on `req.reqId` so pino-http, controllers, and downstream
 * clients all see the same value.
 *
 * Client-supplied ids are trusted (single-user OS, request-id is not a
 * security control) but validated as a plain string to keep the log line
 * boring.
 *
 * pino-http reads `req.id` for its `reqId` field; we set both `req.id` and
 * `req.reqId` so either name works in downstream code.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length < 200
        ? incoming
        : randomUUID();

    (req as unknown as { reqId: string; id: string }).reqId = id;
    (req as unknown as { reqId: string; id: string }).id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}

/**
 * Reusable id-generator that pino-http's `genReqId` calls into so a single
 * source-of-truth decides the id shape. Typed loosely (`unknown` narrowed
 * inside) because pino-http hands us Node's `IncomingMessage` while our own
 * middleware sees Express's `Request` -- both have `headers` and `id`, which
 * is all we need.
 */
export function generateRequestId(req: unknown, res: unknown): string {
  const r = req as { reqId?: string; headers?: Record<string, unknown> };
  const cached = r.reqId;
  if (cached) return cached;
  const incoming = r.headers?.[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length < 200
      ? incoming
      : randomUUID();
  const s = res as { setHeader?: (k: string, v: string) => void };
  s.setHeader?.(REQUEST_ID_HEADER, id);
  return id;
}
