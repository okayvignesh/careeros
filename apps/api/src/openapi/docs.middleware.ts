import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface DocsGateOptions {
  /** Production gates docs behind auth; dev/test stay open (AGENTS.md §6). */
  isProduction: boolean;
  /**
   * True when the request carries a valid, non-revoked session. Async because
   * revocation requires an `active_sessions` lookup.
   */
  hasSession: (req: Request) => Promise<boolean>;
}

const DOCS_UNAVAILABLE = { statusCode: 401, message: 'Authentication required for API docs' };

/**
 * Gate `/api/docs` + `/api/openapi.json` behind a valid session when running
 * `NODE_ENV=production` (plan/security.md, AGENTS.md §6). Fails closed: any
 * error while checking the session is treated as "not authenticated" rather
 * than leaking the API surface.
 */
export function createDocsGate(options: DocsGateOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!options.isProduction) {
      next();
      return;
    }
    options
      .hasSession(req)
      .then((ok) => {
        if (ok) next();
        else res.status(401).json(DOCS_UNAVAILABLE);
      })
      .catch(() => {
        res.status(401).json(DOCS_UNAVAILABLE);
      });
  };
}

/**
 * Swagger UI's HTML has inline `<script>`/`<style>` tags. The app's CSP is
 * nonce-based with no `'unsafe-inline'` (security.md item 2), so stamp the
 * per-request nonce already placed on `res.locals.cspNonce` by main.ts's
 * middleware. Scoped to the docs route; nothing else is touched and the CSP
 * itself is never weakened.
 */
export function createNonceInjector(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    const nonce = (res.locals as { cspNonce?: string }).cspNonce;
    if (!nonce) {
      next();
      return;
    }
    const originalSend = res.send.bind(res) as (body?: unknown) => Response;
    res.send = ((body?: unknown) => {
      const contentType = res.getHeader('Content-Type');
      if (
        typeof body === 'string' &&
        typeof contentType === 'string' &&
        contentType.includes('text/html')
      ) {
        return originalSend(
          body
            .replace(/<script/g, `<script nonce="${nonce}"`)
            .replace(/<style/g, `<style nonce="${nonce}"`),
        );
      }
      return originalSend(body);
    }) as Response['send'];
    next();
  };
}
