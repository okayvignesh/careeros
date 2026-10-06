/**
 * F8 scheduled Firecrawl candidate search worker.
 *
 * Every run (cron `0 *​/6 * * *`, stable jobId `repeat:firecrawl-search` via
 * `registerWorker`) it:
 *   1. triages the kill switch + API key (missing key = clean no-op);
 *   2. loads each candidate's career goals + job preferences + demonstrated
 *      skills, builds bounded queries (`buildCandidateSearchQueries`);
 *   3. runs `FirecrawlClient.search()` → canonical dedupe
 *      (`runCandidateSearch`), charging every call against a
 *      `FirecrawlBudget`;
 *   4. optionally starts configured crawl targets and polls `getCrawlStatus`
 *      with a bounded poll budget (`runCrawlPhase`);
 *   5. feeds hits through normalize → cross-source dedupe → verify
 *      (`planIngest`), persists `jobs_raw` (append-only) + `jobs_normalized`,
 *      and writes `job_reject_log` for hard-fails.
 *
 * Firecrawl hits stay `DISCOVERED` (adapter tier 3): only a canonical ATS board
 * confirmation promotes a listing later in the trust-order/verify stages.
 * LinkedIn/Indeed/Naukri/Glassdoor are permitted via Firecrawl (owner decision
 * 2026-10-06), so no host is filtered. The API key is never logged.
 */
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import {
  buildCandidateSearchQueries,
  planIngest,
  runCandidateSearch,
  type CandidateSearchRunResult,
  type FirecrawlJobClient,
  type IngestPlan,
  type NormalizedJob,
  type RawJob,
} from '@careeros/job-pipeline';
import { createFirecrawlClient, readFirecrawlApiKey } from '@careeros/firecrawl';
import { decryptField, loadMasterKey } from '@careeros/secrets';
import {
  QUEUE_FIRECRAWL_SEARCH,
  JOB_FIRECRAWL_SEARCH,
  rateLimitFor,
  type FirecrawlSearchPayload,
} from '@careeros/shared';
import {
  FirecrawlBudget,
  isFirecrawlKilled,
  readFirecrawlBudgetConfig,
  type FirecrawlCostReport,
} from './firecrawl-budget.js';
import { runCrawlPhase } from './firecrawl-crawl.js';

export { QUEUE_FIRECRAWL_SEARCH, JOB_FIRECRAWL_SEARCH };
export type { FirecrawlSearchPayload };

/** Every 6 hours, off the top of the hour. */
export const FIRECRAWL_SEARCH_CRON = '0 */6 * * *';

const MAX_CANDIDATE_SKILLS = 8;

export type WorkerLogger = Pick<Logger, 'info' | 'warn' | 'error'>;

// ---------------------------------------------------------------------------
// Prisma surface (structural so tests stub with plain objects; main.ts casts)
// ---------------------------------------------------------------------------

export interface CandidateGoalRow {
  userId: string;
  targetRoles: string[];
  locations: string[];
  remoteOnly: boolean;
  seniority: string[];
}

export interface CandidatePrefsRow {
  targetRoles: string[];
  locations: string[];
  remoteOnly: boolean;
  mustHaveSkills: string[];
  dealbreakerSkills: string[];
}

export interface FirecrawlSearchRepo {
  careerGoal: { findMany(args?: unknown): Promise<CandidateGoalRow[]> };
  userJobPreferences: {
    findUnique(args: { where: { userId: string } }): Promise<CandidatePrefsRow | null>;
  };
  candidateSkillState: {
    findMany(
      args: unknown,
    ): Promise<Array<{ skillId: string; proficiency: number; recencyDays: number | null }>>;
  };
  skill: { findMany(args?: unknown): Promise<Array<{ id: string; name: string }>> };
  jobRaw: { createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }> };
  normalizedJob: {
    findMany(args: {
      where: { canonicalUrl: { in: string[] } };
      select: { canonicalUrl: true; sourceIds: true };
    }): Promise<Array<{ canonicalUrl: string; sourceIds: string[] }>>;
    createMany(args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates?: boolean;
    }): Promise<{ count: number }>;
    update(args: { where: { canonicalUrl: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  jobRejectLog: { createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }> };
  auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  /** Optional: present on the real Prisma client, absent on plain-object test stubs. */
  appConfig?: {
    findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null>;
  };
}

const FIRECRAWL_CONFIG_KEY = 'provider_config:firecrawl';
const FIRECRAWL_KEY_PURPOSE = 'provider.firecrawl.apiKey';

function readSealedSecret(value: unknown, field: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const secrets = (value as { secrets?: unknown }).secrets;
  if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) return null;
  const raw = (secrets as Record<string, unknown>)[field];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

/**
 * Resolve the Firecrawl key DB-first (`provider_config:firecrawl`, sealed with
 * `packages/secrets`) then env as a last-resort fallback. Returns null when no
 * usable key exists. `decryptField` passes legacy plaintext through unchanged.
 */
export async function resolveFirecrawlApiKey(
  repo: FirecrawlSearchRepo,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    const row = await repo.appConfig?.findUnique({ where: { key: FIRECRAWL_CONFIG_KEY } });
    const sealed = readSealedSecret(row?.value, 'apiKey');
    if (sealed) return decryptField(sealed, loadMasterKey(), FIRECRAWL_KEY_PURPOSE);
  } catch {
    // A malformed/undecryptable stored key must not crash the run; fall back to env.
  }
  return readFirecrawlApiKey(env);
}

// ---------------------------------------------------------------------------
// Profile loading
// ---------------------------------------------------------------------------

export interface CandidateSearchPlan {
  userId: string;
  queries: string[];
}

export async function loadCandidateSearchPlans(
  repo: FirecrawlSearchRepo,
): Promise<CandidateSearchPlan[]> {
  const goals = await repo.careerGoal.findMany();
  if (goals.length === 0) return [];
  const catalogue = await repo.skill.findMany({ select: { id: true, name: true } });
  const nameById = new Map(catalogue.map((s) => [s.id, s.name]));
  const names = (ids: readonly string[]): string[] =>
    ids.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n));

  const plans: CandidateSearchPlan[] = [];
  for (const goal of goals) {
    const prefs = await repo.userJobPreferences.findUnique({ where: { userId: goal.userId } });
    const skillStates = await repo.candidateSkillState.findMany({
      where: { userId: goal.userId },
      select: { skillId: true, proficiency: true, recencyDays: true },
      orderBy: { proficiency: 'desc' },
      take: MAX_CANDIDATE_SKILLS,
    });
    const queries = buildCandidateSearchQueries({
      targetRoles: prefs?.targetRoles.length ? prefs.targetRoles : goal.targetRoles,
      locations: prefs?.locations.length ? prefs.locations : goal.locations,
      remoteOnly: goal.remoteOnly || (prefs?.remoteOnly ?? false),
      seniority: goal.seniority,
      mustHaveSkills: names(prefs?.mustHaveSkills ?? []),
      dealbreakerSkills: names(prefs?.dealbreakerSkills ?? []),
      candidateSkills: skillStates.map((s) => nameById.get(s.skillId)).filter((n): n is string => Boolean(n)),
    });
    if (queries.length > 0) plans.push({ userId: goal.userId, queries });
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Persistence (jobs_raw append-only → jobs_normalized upsert)
// ---------------------------------------------------------------------------

export interface PersistStats {
  rawInserted: number;
  normalizedInserted: number;
  normalizedUpdated: number;
  rejected: number;
}

export async function persistPlan(
  repo: FirecrawlSearchRepo,
  raws: RawJob[],
  plan: IngestPlan,
  now: Date,
): Promise<PersistStats> {
  const stats: PersistStats = {
    rawInserted: 0,
    normalizedInserted: 0,
    normalizedUpdated: 0,
    rejected: 0,
  };

  if (raws.length > 0) {
    const result = await repo.jobRaw.createMany({
      data: raws.map((r) => ({
        source: r.sourceName,
        sourceId: r.sourceId,
        canonicalUrl: r.canonicalUrl,
        payload: r.payload,
        fetchedAt: r.fetchedAt,
      })),
    });
    stats.rawInserted = result.count;
  }

  if (plan.rejected.length > 0) {
    const result = await repo.jobRejectLog.createMany({
      data: plan.rejected.map((r) => ({
        jobRawId: null,
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        reason: r.reason,
        verdict: 'rejected',
        details: r.details,
      })),
    });
    stats.rejected = result.count;
  }

  const urls = plan.normalized.map((n) => n.canonicalUrl);
  if (urls.length === 0) return stats;

  const existingRows = await repo.normalizedJob.findMany({
    where: { canonicalUrl: { in: urls } },
    select: { canonicalUrl: true, sourceIds: true },
  });
  const existingByUrl = new Map(existingRows.map((r) => [r.canonicalUrl, r.sourceIds]));

  const toInsert: Array<Record<string, unknown>> = [];
  const toUpdate: Array<{ n: NormalizedJob; existingSourceIds: string[] }> = [];
  for (const n of plan.normalized) {
    const existing = existingByUrl.get(n.canonicalUrl);
    if (existing) toUpdate.push({ n, existingSourceIds: existing });
    else toInsert.push(normalizedInsertData(n, plan));
  }

  if (toInsert.length > 0) {
    const result = await repo.normalizedJob.createMany({ data: toInsert, skipDuplicates: true });
    stats.normalizedInserted = result.count;
  }
  for (const { n, existingSourceIds } of toUpdate) {
    await repo.normalizedJob.update({
      where: { canonicalUrl: n.canonicalUrl },
      data: normalizedUpdateData(n, plan, existingSourceIds, now),
    });
    stats.normalizedUpdated++;
  }
  return stats;
}

function normalizedInsertData(n: NormalizedJob, plan: IngestPlan): Record<string, unknown> {
  return {
    canonicalUrl: n.canonicalUrl,
    title: n.title,
    company: n.company,
    location: n.location,
    remote: n.remote,
    description: n.description,
    sourcePostedAt: n.sourcePostedAt,
    primarySource: n.primarySource,
    sourceIds: plan.mergedSourceTagsByWinner.get(n) ?? [n.sourceTag],
  };
}

function normalizedUpdateData(
  n: NormalizedJob,
  plan: IngestPlan,
  existingSourceIds: string[],
  now: Date,
): Record<string, unknown> {
  return {
    title: n.title,
    company: n.company,
    location: n.location,
    remote: n.remote,
    description: n.description,
    sourcePostedAt: n.sourcePostedAt,
    lastVerifiedAt: now,
    sourceIds: uniq([...existingSourceIds, ...(plan.mergedSourceTagsByWinner.get(n) ?? [n.sourceTag])]),
  };
}

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

export interface FirecrawlSearchRunSummary {
  runAt: string;
  usersConsidered: number;
  usersSearched: number;
  queries: number;
  fetched: number;
  rawInserted: number;
  normalizedInserted: number;
  normalizedUpdated: number;
  rejected: number;
  merged: number;
  crawlJobsStarted: number;
  crawlCreditsUsed: number;
  killed: boolean;
  skippedReason?: string;
  cost: FirecrawlCostReport;
}

export interface FirecrawlSearchCycleOptions {
  repo: FirecrawlSearchRepo;
  client: FirecrawlJobClient;
  logger: WorkerLogger;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  budget?: FirecrawlBudget;
  /** Scope to one candidate (manual run). Omit for the all-candidates sweep. */
  onlyUserId?: string;
  /** Test seam for the crawl phase (defaults to the real implementation). */
  crawlPhase?: typeof runCrawlPhase;
}

export async function runFirecrawlSearchCycle(
  options: FirecrawlSearchCycleOptions,
): Promise<FirecrawlSearchRunSummary> {
  const env = options.env ?? process.env;
  const logger = options.logger;
  const now = options.now ?? (() => new Date());
  const budget = options.budget ?? new FirecrawlBudget(readFirecrawlBudgetConfig(env));
  const runAt = now().toISOString();

  if (isFirecrawlKilled(env)) {
    logger.warn({ job: JOB_FIRECRAWL_SEARCH }, 'firecrawl-search: kill switch tripped; no new crawls');
    await audit(options.repo, 'job.firecrawl_search.killed', { runAt, reason: 'kill-switch' }, now());
    return emptySummary(runAt, budget.report(), { killed: true, skippedReason: 'kill-switch' });
  }

  const allPlans = await loadCandidateSearchPlans(options.repo);
  const plans = options.onlyUserId
    ? allPlans.filter((p) => p.userId === options.onlyUserId)
    : allPlans;
  const summary: FirecrawlSearchRunSummary = {
    runAt,
    usersConsidered: plans.length,
    usersSearched: 0,
    queries: 0,
    fetched: 0,
    rawInserted: 0,
    normalizedInserted: 0,
    normalizedUpdated: 0,
    rejected: 0,
    merged: 0,
    crawlJobsStarted: 0,
    crawlCreditsUsed: 0,
    killed: false,
    cost: budget.report(),
  };

  for (const plan of plans) {
    if (isFirecrawlKilled(env) || !budget.allow(1)) {
      summary.killed = summary.killed || isFirecrawlKilled(env);
      break;
    }
    const run = await runCandidateSearch({
      client: options.client,
      queries: plan.queries,
      scrapeDetails: readScrapeDetails(env),
      maxScrapes: readPositiveInt(env.FIRECRAWL_MAX_SCRAPES_PER_RUN, 10),
      minIntervalMs: readMinIntervalMs(env),
      shouldStop: () => isFirecrawlKilled(env) || !budget.allow(1),
      onCall: (_kind, credits) => {
        budget.spend(credits);
      },
    });
    applySearchStats(summary, run);
    await persistFetched(options.repo, run.raw, now(), summary);
  }

  // Optional crawl phase for configured public career-site boards.
  const targets = readCrawlTargets(env);
  if (targets.length > 0 && !isFirecrawlKilled(env) && budget.allow(1)) {
    try {
      const crawl = await (options.crawlPhase ?? runCrawlPhase)({
        client: options.client as unknown as Parameters<typeof runCrawlPhase>[0]['client'],
        targets,
        budget,
        logger,
        env,
      });
      summary.crawlJobsStarted = crawl.started;
      summary.crawlCreditsUsed = crawl.creditsUsed;
      await persistFetched(options.repo, crawl.raw, now(), summary);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'firecrawl-search: crawl phase failed');
    }
  }

  summary.cost = budget.report();
  logger.info(
    {
      job: JOB_FIRECRAWL_SEARCH,
      usersConsidered: summary.usersConsidered,
      usersSearched: summary.usersSearched,
      queries: summary.queries,
      fetched: summary.fetched,
      normalizedInserted: summary.normalizedInserted,
      rejected: summary.rejected,
      creditsSpent: summary.cost.creditsSpent,
      usdEstimate: summary.cost.usdEstimate,
      killed: summary.killed,
    },
    'firecrawl-search run complete',
  );
  await audit(options.repo, 'job.firecrawl_search', summary as unknown as Record<string, unknown>, now());
  return summary;
}

async function persistFetched(
  repo: FirecrawlSearchRepo,
  raws: RawJob[],
  now: Date,
  summary: FirecrawlSearchRunSummary,
): Promise<void> {
  if (raws.length === 0) return;
  const plan = planIngest(raws);
  const stats = await persistPlan(repo, raws, plan, now);
  summary.rawInserted += stats.rawInserted;
  summary.normalizedInserted += stats.normalizedInserted;
  summary.normalizedUpdated += stats.normalizedUpdated;
  summary.rejected += stats.rejected;
  summary.merged += plan.duplicates.length;
}

function applySearchStats(
  summary: FirecrawlSearchRunSummary,
  run: CandidateSearchRunResult,
): void {
  if (run.calls.search > 0) summary.usersSearched++;
  summary.queries += run.queriesRun;
  summary.fetched += run.raw.length;
}

async function audit(
  repo: FirecrawlSearchRepo,
  action: string,
  payload: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await repo.auditEvent
    .create({
      data: {
        userId: null,
        actor: 'system',
        action,
        resourceType: 'firecrawl_run',
        resourceId: now.toISOString(),
        payload,
      },
    })
    .catch(() => {
      /* audit must never sink the run */
    });
}

// ---------------------------------------------------------------------------
// BullMQ handler
// ---------------------------------------------------------------------------

export interface HandleFirecrawlSearchDeps {
  env?: NodeJS.ProcessEnv;
  createClient?: (opts: { env: NodeJS.ProcessEnv }) => FirecrawlJobClient;
}

export async function handleFirecrawlSearch(
  prisma: PrismaClient,
  logger: WorkerLogger,
  payload: FirecrawlSearchPayload,
  deps: HandleFirecrawlSearchDeps = {},
): Promise<FirecrawlSearchRunSummary | { skipped: true; reason: string }> {
  const env = deps.env ?? process.env;
  const repo = prisma as unknown as FirecrawlSearchRepo;

  const apiKey = await resolveFirecrawlApiKey(repo, env);
  if (!apiKey) {
    logger.warn(
      { job: JOB_FIRECRAWL_SEARCH },
      'firecrawl-search: no API key in DB or FIRECRAWL_API_KEY; skipping',
    );
    await audit(repo, 'job.firecrawl_search.unconfigured', { reason: 'missing-api-key' }, new Date());
    return { skipped: true, reason: 'missing-api-key' };
  }

  const client = deps.createClient
    ? deps.createClient({ env })
    : (createFirecrawlClient({ apiKey, env }) as unknown as FirecrawlJobClient);

  return runFirecrawlSearchCycle({
    repo,
    client,
    logger,
    env,
    budget: new FirecrawlBudget(readFirecrawlBudgetConfig(env)),
    ...(payload.userId ? { onlyUserId: payload.userId } : {}),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySummary(
  runAt: string,
  cost: FirecrawlCostReport,
  extra: Partial<FirecrawlSearchRunSummary>,
): FirecrawlSearchRunSummary {
  return {
    runAt,
    usersConsidered: 0,
    usersSearched: 0,
    queries: 0,
    fetched: 0,
    rawInserted: 0,
    normalizedInserted: 0,
    normalizedUpdated: 0,
    rejected: 0,
    merged: 0,
    crawlJobsStarted: 0,
    crawlCreditsUsed: 0,
    killed: false,
    cost,
    ...extra,
  };
}

function readCrawlTargets(env: NodeJS.ProcessEnv): string[] {
  const raw = env.FIRECRAWL_CRAWL_TARGETS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function readScrapeDetails(env: NodeJS.ProcessEnv): boolean {
  const raw = env.FIRECRAWL_SCRAPE_DETAILS;
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Per-host pacing between search calls, derived from the shared Firecrawl rate
 * limit. `FIRECRAWL_MIN_INTERVAL_MS` overrides it (0 disables the wait for
 * tests / local runs).
 */
export function readMinIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FIRECRAWL_MIN_INTERVAL_MS;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  const perMinute = rateLimitFor('firecrawl')?.callsPerMinute ?? 10;
  return perMinute > 0 ? Math.ceil(60_000 / perMinute) : 0;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
