import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * C-P4.8: increment `careeros_http_requests_total` + record duration for
 * every request. Route label uses `req.route?.path` when the router has
 * matched (so `/users/123` collapses to `/users/:id`), falling back to
 * `req.baseUrl + req.path` -> raw URL for unmatched paths.
 *
 * We hook `res.on('finish')` for status + duration; that's the same signal
 * pino-http uses, so the metric and the request log agree on outcome.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      const route = routeLabel(req);
      const method = req.method;
      const status = String(res.statusCode);

      this.metrics.httpRequestsTotal.inc({ method, route, status });
      this.metrics.httpRequestDurationSeconds.observe({ method, route }, durationSec);
    });

    next();
  }
}

/**
 * Prefer the matched-route template so label cardinality stays bounded
 * (e.g. `/users/:id` not `/users/42`). If Express hasn't matched a route
 * yet (404, error before routing) fall back to a sanitised URL so we still
 * see the traffic.
 *
 * ponytail: bounded fallback: raw URL path only (no query). If a bad
 * client blasts `/does-not-exist-<uuid>` we'd still leak cardinality;
 * add a `/not-found` collapse if this shows up in ops.
 */
function routeLabel(req: Request): string {
  const route = (req as unknown as { route?: { path?: string } }).route?.path;
  if (typeof route === 'string' && route.length > 0) {
    const base = (req as unknown as { baseUrl?: string }).baseUrl ?? '';
    return `${base}${route}` || route;
  }
  const url = req.originalUrl ?? req.url ?? '/';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}
