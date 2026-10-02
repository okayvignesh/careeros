/**
 * Typed Firecrawl v1 client. All egress goes through `safeFetch` from
 * `@careeros/shared/net` (SSRF allowlist + redirect re-validation) and all
 * retries through `@careeros/shared` retry (429/5xx/network only). Requests and
 * responses are Zod-validated; the API key is only ever sent as a Bearer header
 * and is never logged.
 *
 * Scope: F1 foundation. F4-F8 build adapters / pipeline wiring / scheduled crawl
 * / candidate-targeted search on top of this interface.
 */
import { retry } from '@careeros/shared';
import { safeFetch, SsrfBlockedError, type AssertPublicUrlOptions } from '@careeros/shared/net';
import { ZodError } from 'zod';
import { readFirecrawlApiKey } from './config';
import {
  FirecrawlApiError,
  FirecrawlConfigError,
  FirecrawlMalformedResponseError,
  FirecrawlTimeoutError,
} from './errors';
import {
  FirecrawlCrawlJobSchema,
  FirecrawlCrawlRequestSchema,
  FirecrawlCrawlStatusResponseSchema,
  FirecrawlErrorEnvelopeSchema,
  FirecrawlScrapeRequestSchema,
  FirecrawlScrapeResponseSchema,
  FirecrawlSearchRequestSchema,
  FirecrawlSearchResponseSchema,
  type FirecrawlCrawlJob,
  type FirecrawlCrawlRequest,
  type FirecrawlCrawlStatus,
  type FirecrawlScrapeRequest,
  type FirecrawlScrapeResponse,
  type FirecrawlSearchRequest,
  type FirecrawlSearchResponse,
} from './schemas';

export const FIRECRAWL_API_HOST = 'api.firecrawl.dev';
export const FIRECRAWL_API_BASE_URL = `https://${FIRECRAWL_API_HOST}/v1`;
export const DEFAULT_FIRECRAWL_TIMEOUT_MS = 60_000;
export const DEFAULT_FIRECRAWL_RETRY_ATTEMPTS = 3;

export interface FirecrawlClientOptions {
  /** Explicit key (e.g. decrypted from EncryptedSecret). Falls back to env. */
  apiKey?: string;
  /** Override for tests / self-hosted gateways. Must be allowlisted. */
  baseUrl?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseMs?: number;
  /** Extra hostnames allowed on top of `api.firecrawl.dev`. */
  allowlist?: string[];
  /** Injectable DNS resolver so tests never hit the network. */
  lookup?: AssertPublicUrlOptions['lookup'];
  nodeEnv?: string;
  /** Env source for the key lookup; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

type HttpMethod = 'GET' | 'POST';

export class FirecrawlClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryBaseMs: number;
  private readonly safeFetchOpts: AssertPublicUrlOptions;

  constructor(opts: FirecrawlClientOptions = {}) {
    const apiKey = opts.apiKey?.trim() || readFirecrawlApiKey(opts.env ?? process.env);
    if (!apiKey) {
      throw new FirecrawlConfigError(
        'FIRECRAWL_API_KEY is not set — Firecrawl source is unavailable',
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (opts.baseUrl ?? FIRECRAWL_API_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_FIRECRAWL_TIMEOUT_MS;
    this.retryAttempts = opts.retryAttempts ?? DEFAULT_FIRECRAWL_RETRY_ATTEMPTS;
    this.retryBaseMs = opts.retryBaseMs ?? 500;

    this.safeFetchOpts = {
      allowlist: [FIRECRAWL_API_HOST, ...(opts.allowlist ?? [])],
    };
    if (opts.lookup) this.safeFetchOpts.lookup = opts.lookup;
    if (opts.nodeEnv) this.safeFetchOpts.nodeEnv = opts.nodeEnv;
  }

  /** POST /v1/scrape — scrape a single URL into markdown/html/links. */
  async scrape(req: FirecrawlScrapeRequest): Promise<FirecrawlScrapeResponse> {
    const body = FirecrawlScrapeRequestSchema.parse(req);
    return this.call('POST', '/scrape', body, FirecrawlScrapeResponseSchema.parse);
  }

  /** POST /v1/search — candidate-targeted / source discovery search (F8). */
  async search(req: FirecrawlSearchRequest): Promise<FirecrawlSearchResponse> {
    const body = FirecrawlSearchRequestSchema.parse(req);
    return this.call('POST', '/search', body, FirecrawlSearchResponseSchema.parse);
  }

  /**
   * POST /v1/crawl — start an async crawl. Returns the job handle; poll with
   * `getCrawlStatus(id)`. A polling helper is intentionally left to F8 so the
   * scheduled worker owns its own cadence and budget.
   */
  async crawl(req: FirecrawlCrawlRequest): Promise<FirecrawlCrawlJob> {
    const body = FirecrawlCrawlRequestSchema.parse(req);
    return this.call('POST', '/crawl', body, FirecrawlCrawlJobSchema.parse);
  }

  /** GET /v1/crawl/:id — current crawl status + fetched pages. */
  async getCrawlStatus(id: string): Promise<FirecrawlCrawlStatus> {
    if (!id.trim()) throw new FirecrawlConfigError('crawl id is required');
    return this.call(
      'GET',
      `/crawl/${encodeURIComponent(id)}`,
      undefined,
      FirecrawlCrawlStatusResponseSchema.parse,
    );
  }

  private readonly shouldRetry = (err: unknown): boolean => {
    if (
      err instanceof FirecrawlConfigError ||
      err instanceof FirecrawlMalformedResponseError ||
      err instanceof SsrfBlockedError
    ) {
      return false;
    }
    if (err instanceof FirecrawlApiError) {
      return err.status === 429 || (err.status >= 500 && err.status < 600);
    }
    // Timeouts, DNS, connection resets → let shared retry decide.
    return true;
  };

  private async call<T>(
    method: HttpMethod,
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> {
    return retry(
      async () => {
        const json = await this.request(method, path, body);
        try {
          return parse(json);
        } catch (err) {
          if (err instanceof ZodError) {
            throw new FirecrawlMalformedResponseError(path, err.message);
          }
          throw err;
        }
      },
      {
        attempts: this.retryAttempts,
        baseMs: this.retryBaseMs,
        shouldRetry: (err) => this.shouldRetry(err),
      },
    );
  }

  private async request(method: HttpMethod, path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await safeFetch(
        `${this.baseUrl}${path}`,
        {
          method,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        },
        this.safeFetchOpts,
      );
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new FirecrawlTimeoutError(path, this.timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new FirecrawlMalformedResponseError(path, 'body was not valid JSON');
    }

    const envelope = FirecrawlErrorEnvelopeSchema.safeParse(json);
    if (!res.ok) {
      const message =
        envelope.success && envelope.data.error ? envelope.data.error : `HTTP ${res.status}`;
      throw new FirecrawlApiError(res.status, message);
    }
    if (envelope.success && envelope.data.success === false) {
      throw new FirecrawlApiError(res.status, envelope.data.error ?? 'request failed');
    }
    return json;
  }
}

/** Convenience factory mirroring the other source-adapter modules. */
export function createFirecrawlClient(opts: FirecrawlClientOptions = {}): FirecrawlClient {
  return new FirecrawlClient(opts);
}
