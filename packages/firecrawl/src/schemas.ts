/**
 * Zod schemas for the Firecrawl v1 API (https://api.firecrawl.dev/v1).
 *
 * These sit at the trust boundary: every upstream body is validated before it
 * is handed to callers. Objects use `.passthrough()` because Firecrawl adds
 * fields over time and a strict schema would turn a forward-compatible upstream
 * into a hard failure. Required fields, however, are real requirements.
 */
import { z } from 'zod';

// ─── Shared building blocks ────────────────────────────────────────────────

export const FirecrawlScrapeMetadataSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    language: z.string().optional(),
    sourceURL: z.string().optional(),
    url: z.string().optional(),
    statusCode: z.number().optional(),
  })
  .passthrough();

export const FirecrawlScrapeDataSchema = z
  .object({
    markdown: z.string().optional(),
    html: z.string().optional(),
    rawHtml: z.string().optional(),
    links: z.array(z.string()).optional(),
    metadata: FirecrawlScrapeMetadataSchema.optional(),
  })
  .passthrough();

const FORMATS = [
  'markdown',
  'html',
  'rawHtml',
  'links',
  'screenshot',
  'extract',
  'changeTracking',
] as const;

export const FirecrawlScrapeOptionsSchema = z
  .object({
    formats: z.array(z.enum(FORMATS)).optional(),
    onlyMainContent: z.boolean().optional(),
    includeTags: z.array(z.string()).optional(),
    excludeTags: z.array(z.string()).optional(),
    waitFor: z.number().int().nonnegative().optional(),
    timeout: z.number().int().positive().optional(),
    mobile: z.boolean().optional(),
  })
  .passthrough();

// ─── Scrape ─────────────────────────────────────────────────────────────────

export const FirecrawlScrapeRequestSchema = FirecrawlScrapeOptionsSchema.extend({
  url: z.string().url(),
});

export const FirecrawlScrapeResponseSchema = z
  .object({
    success: z.literal(true),
    data: FirecrawlScrapeDataSchema,
  })
  .passthrough();

// ─── Search ─────────────────────────────────────────────────────────────────

export const FirecrawlSearchResultSchema = z
  .object({
    url: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    markdown: z.string().optional(),
    html: z.string().optional(),
    rawHtml: z.string().optional(),
    links: z.array(z.string()).optional(),
    metadata: FirecrawlScrapeMetadataSchema.optional(),
  })
  .passthrough();

export const FirecrawlSearchRequestSchema = z
  .object({
    query: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
    tbs: z.string().optional(),
    lang: z.string().optional(),
    country: z.string().optional(),
    location: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    scrapeOptions: FirecrawlScrapeOptionsSchema.optional(),
  })
  .passthrough();

export const FirecrawlSearchResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(FirecrawlSearchResultSchema),
  })
  .passthrough();

// ─── Crawl (start + status) ─────────────────────────────────────────────────

export const FirecrawlCrawlRequestSchema = z
  .object({
    url: z.string().url(),
    limit: z.number().int().positive().optional(),
    maxDiscoveryDepth: z.number().int().nonnegative().optional(),
    includePaths: z.array(z.string()).optional(),
    excludePaths: z.array(z.string()).optional(),
    allowExternalLinks: z.boolean().optional(),
    allowSubdomains: z.boolean().optional(),
    ignoreRobotsTxt: z.boolean().optional(),
    scrapeOptions: FirecrawlScrapeOptionsSchema.optional(),
  })
  .passthrough();

export const FirecrawlCrawlJobSchema = z
  .object({
    success: z.literal(true),
    id: z.string(),
    url: z.string().optional(),
  })
  .passthrough();

export const FIRECRAWL_CRAWL_STATUSES = [
  'scraping',
  'completed',
  'failed',
  'cancelled',
] as const;

export const FirecrawlCrawlStatusResponseSchema = z
  .object({
    status: z.enum(FIRECRAWL_CRAWL_STATUSES),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    creditsUsed: z.number().optional(),
    expiresAt: z.string().optional(),
    data: z.array(FirecrawlScrapeDataSchema).default([]),
    next: z.string().nullable().optional(),
  })
  .passthrough();

// ─── Error envelope (checked before the success schemas) ────────────────────

export const FirecrawlErrorEnvelopeSchema = z
  .object({
    success: z.boolean().optional(),
    error: z.string().optional(),
  })
  .passthrough();

// ─── Inferred types ─────────────────────────────────────────────────────────

export type FirecrawlScrapeMetadata = z.infer<typeof FirecrawlScrapeMetadataSchema>;
export type FirecrawlScrapeData = z.infer<typeof FirecrawlScrapeDataSchema>;
export type FirecrawlScrapeOptions = z.infer<typeof FirecrawlScrapeOptionsSchema>;
export type FirecrawlScrapeRequest = z.infer<typeof FirecrawlScrapeRequestSchema>;
export type FirecrawlScrapeResponse = z.infer<typeof FirecrawlScrapeResponseSchema>;
export type FirecrawlSearchResult = z.infer<typeof FirecrawlSearchResultSchema>;
export type FirecrawlSearchRequest = z.infer<typeof FirecrawlSearchRequestSchema>;
export type FirecrawlSearchResponse = z.infer<typeof FirecrawlSearchResponseSchema>;
export type FirecrawlCrawlRequest = z.infer<typeof FirecrawlCrawlRequestSchema>;
export type FirecrawlCrawlJob = z.infer<typeof FirecrawlCrawlJobSchema>;
export type FirecrawlCrawlStatus = z.infer<typeof FirecrawlCrawlStatusResponseSchema>;
