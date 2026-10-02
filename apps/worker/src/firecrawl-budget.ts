/**
 * F8 Firecrawl credit accounting + kill switch.
 *
 * `FirecrawlBudget` is the single gate every Firecrawl call passes through.
 * It enforces a per-run cap (the worker creates one budget per run) and an
 * in-process per-day cap. Both are operator-configurable; the API key is never
 * read here and never logged.
 *
 * ponytail: the daily counter is in-memory, so it resets when the worker
 * restarts and is per-replica. A single-user self-hosted deployment runs one
 * worker, so this is enough; move to Redis (`INCRBY`) when replicas > 1 or
 * restarts are frequent enough to under-count.
 *
 * The kill switch stops *new* crawls: env flag `FIRECRAWL_KILL_SWITCH` truthy,
 * or a pause file present (default `/var/run/careeros/firecrawl.paused`,
 * override `FIRECRAWL_PAUSED_FILE`). Mirrors the browser-agent kill-switch
 * pattern.
 */
import { existsSync } from 'node:fs';

export const FIRECRAWL_MAX_CREDITS_PER_RUN_ENV = 'FIRECRAWL_MAX_CREDITS_PER_RUN';
export const FIRECRAWL_MAX_CREDITS_PER_DAY_ENV = 'FIRECRAWL_MAX_CREDITS_PER_DAY';
export const FIRECRAWL_USD_PER_CREDIT_ENV = 'FIRECRAWL_USD_PER_CREDIT';
export const FIRECRAWL_KILL_SWITCH_ENV = 'FIRECRAWL_KILL_SWITCH';
export const FIRECRAWL_PAUSED_FILE_ENV = 'FIRECRAWL_PAUSED_FILE';

export const DEFAULT_MAX_CREDITS_PER_RUN = 25;
export const DEFAULT_MAX_CREDITS_PER_DAY = 200;
export const DEFAULT_PAUSED_FILE = '/var/run/careeros/firecrawl.paused';

export interface FirecrawlBudgetConfig {
  maxCreditsPerRun: number;
  maxCreditsPerDay: number;
  /** Optional cost estimate; 0 means "credits only, no USD". */
  usdPerCredit: number;
}

export interface FirecrawlCostReport {
  creditsSpent: number;
  creditsRemaining: number;
  creditsCap: number;
  usdEstimate: number;
  usdCap: number;
}

export function readFirecrawlBudgetConfig(
  env: NodeJS.ProcessEnv = process.env,
): FirecrawlBudgetConfig {
  return {
    maxCreditsPerRun: readPositiveNumber(
      env[FIRECRAWL_MAX_CREDITS_PER_RUN_ENV],
      DEFAULT_MAX_CREDITS_PER_RUN,
    ),
    maxCreditsPerDay: readPositiveNumber(
      env[FIRECRAWL_MAX_CREDITS_PER_DAY_ENV],
      DEFAULT_MAX_CREDITS_PER_DAY,
    ),
    usdPerCredit: readNonNegativeNumber(env[FIRECRAWL_USD_PER_CREDIT_ENV], 0),
  };
}

export interface FirecrawlBudgetOptions {
  /** Credits already spent today (in-memory across runs in this process). */
  spentToday?: number;
}

/**
 * Per-run + per-day credit gate. `allow(n)` answers "may I issue a call that
 * costs n credits (and does it fit today's budget)?"; `spend(n)` records it.
 */
export class FirecrawlBudget {
  private runSpent = 0;
  private daySpent: number;

  constructor(
    private readonly config: FirecrawlBudgetConfig = readFirecrawlBudgetConfig(),
    options: FirecrawlBudgetOptions = {},
  ) {
    this.daySpent = Math.max(0, options.spentToday ?? 0);
  }

  get creditsSpent(): number {
    return this.runSpent;
  }

  get dayCreditsSpent(): number {
    return this.daySpent;
  }

  get creditsRemaining(): number {
    return Math.max(0, this.config.maxCreditsPerRun - this.runSpent);
  }

  /** True when `credits` fit both the run and day caps. */
  allow(credits = 1): boolean {
    if (credits <= 0) return true;
    return (
      this.runSpent + credits <= this.config.maxCreditsPerRun &&
      this.daySpent + credits <= this.config.maxCreditsPerDay
    );
  }

  /**
   * Record spend. Returns false (and records nothing) when the call would
   * exceed a cap, so a caller can treat it as a hard stop.
   */
  spend(credits = 1): boolean {
    if (!this.allow(credits)) return false;
    this.runSpent += credits;
    this.daySpent += credits;
    return true;
  }

  report(): FirecrawlCostReport {
    const creditsCap = this.config.maxCreditsPerRun;
    const usd = this.runSpent * this.config.usdPerCredit;
    return {
      creditsSpent: this.runSpent,
      creditsRemaining: this.creditsRemaining,
      creditsCap,
      usdEstimate: round2(usd),
      usdCap: round2(creditsCap * this.config.usdPerCredit),
    };
  }
}

/** Resolve the pause-file path from env (default {@link DEFAULT_PAUSED_FILE}). */
export function firecrawlPausedFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[FIRECRAWL_PAUSED_FILE_ENV];
  return raw && raw.trim().length > 0 ? raw.trim() : DEFAULT_PAUSED_FILE;
}

/**
 * True when new Firecrawl crawls must not start. Checks the env flag first,
 * then the pause file. `fileExists` is injectable for tests.
 */
export function isFirecrawlKilled(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): boolean {
  if (isTruthy(env[FIRECRAWL_KILL_SWITCH_ENV])) return true;
  return fileExists(firecrawlPausedFilePath(env));
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const n = readNonNegativeNumber(value, fallback);
  return n > 0 ? n : fallback;
}

function readNonNegativeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
