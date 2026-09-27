import { Controller, Get, Header, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MetricsService } from './metrics.service';

/**
 * C-P4.8: Prometheus-scrape endpoint.
 *
 * Deliberately unauthenticated: Prometheus scrapes anonymously and network
 * ACLs are the right place to lock it down (docker-compose exposes 3001 on
 * the internal bridge only; nginx does not proxy /metrics). Throttled to 10
 * req/min per IP so a scraper misconfigured to 1s intervals doesn't quietly
 * burn CPU rendering the exposition.
 *
 * ?format=json is a courtesy for humans poking at the endpoint by hand; the
 * default text/plain path is what Prometheus consumes.
 */
@Controller('metrics')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(@Query('format') format?: string): Promise<string | unknown> {
    if (format === 'json') return this.metrics.renderJson();
    return this.metrics.render();
  }
}
