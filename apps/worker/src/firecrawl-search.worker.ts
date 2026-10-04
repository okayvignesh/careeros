/**
 * F8 scheduled Firecrawl candidate search worker.
 *
 * Every run (cron `0 *​/6 * * *`, stable jobId `repeat:firecrawl-search` via
 * `registerWorker`) it:
 *   1. triages the kill switch + API key (missing key = clean no-op);
 *   2. loads each candidate's career goals + job preferences + demonstrated
 *      skills, builds bounded queries (`buildCandidateSearchQueries`);
 *   3. runs `FirecrawlClient.search()` → banned-platform filter → canonical
 *      dedupe (`runCandidateSearch`), charging every call against a
 *      `FirecrawlBudget`;
 *   4. optionally starts configured crawl targets and polls `getCrawlStatus`
 *      with a bounded poll budget (`runCrawlPhase`);
 *   5. feeds hits through normalize → cross-source dedupe → verify
 *      (`planIngest`), persists `jobs_raw` (append-only) + `jobs_normalized`,
 *      and writes `job_reject_log` for hard-fails.
 *
 * Firecrawl hits stay `DISCOVERED` (adapter tier 3): only a canonical ATS board
 * confirmation promotes a listing later in the trust-order/verify stages.
 * Banned platforms never reach the pipeline. The API key is never logged.
 */
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import {
  buildCandidateSearchQueries,
  marketTargetsFromProfile,
  planIngest,
  runCandidateSearch,
  type CandidateSearchRunResult,
  type FirecrawlJobClient,
  type IngestPlan,
  type MarketTarget,
  type NormalizedJob,
  type RawJob,
} from '@careeros/job-pipeline';
import { createFirecrawlClient, isFirecrawlConfigured } from '@careeros/firecrawl';
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

/**
 * Goals are only used to enumerate candidate user ids. Targeting fields are
 * read from `UserJobPreferences` (P1 unification) — never from the goal.
 */
export interface CandidateGoalRow {
  userId: string;
}

export interface CandidatePrefsRow {
  targetRoles: string[];
  locations: string[];
  remoteOnly: boolean;
  seniority: string[];
  mustHaveSkills: string[];
  dealbreakerSkills: string[];
  countries: string[];
  cities: unknown;
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
      select: { canonicalUrl: true; sourceIds: true; state: true };
    }): Promise<Array<{ canonicalUrl: string; sourceIds: string[]; state: string }>>;
    createMany(args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates?: boolean;
    }): Promise<{ count: number }>;
    update(args: { where: { canonicalUrl: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  jobRejectLog: { createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }> };
  auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

// ---------------------------------------------------------------------------
// Profile loading
// ---------------------------------------------------------------------------

export interface CandidateSearchPlan {
  userId: string;
  queries: string[];
  /** Per-market scoping for the Firecrawl search requests. */
  targets: MarketTarget[];
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
      targetRoles: prefs?.targetRoles ?? [],
      locations: prefs?.locations ?? [],
      remoteOnly: prefs?.remoteOnly ?? false,
      seniority: prefs?.seniority ?? [],
      mustHaveSkills: names(prefs?.mustHaveSkills ?? []),
      dealbreakerSkills: names(prefs?.dealbreakerSkills ?? []),
      candidateSkills: skillStates.map((s) => nameById.get(s.skillId)).filter((n): n is string => Boolean(n)),
    });
    if (queries.length === 0) continue;
    const targets = marketTargetsFromProfile({
      countries: prefs?.countries ?? [],
      cities: parseCities(prefs?.cities),
    });
    plans.push({ userId: goal.userId, queries, targets });
  }
  return plans;
}

/** Defensive parse of the `cities` JSON column into `{ country, city }[]`. */
function parseCities(raw: unknown): Array<{ country: string; city: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ country: string; city: string }> = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { country?: unknown }).country === 'string' &&
      typeof (entry as { city?: unknown }).city === 'string'
    ) {
      out.push({ country: (entry as { country: string }).country, city: (entry as { city: string }).city });
    }
  }
  return out;
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
    select: { canonicalUrl: true, sourceIds: true, state: true },
  });
  const existingByUrl = new Map(existingRows.map((r) => [r.canonicalUrl, r]));

  const toInsert: Array<Record<string, unknown>> = [];
  const toUpdate: Array<{ n: NormalizedJob; existingSourceIds: string[]; existingState: string }> = [];
  for (const n of plan.normalized) {
    const existing = existingByUrl.get(n.canonicalUrl);
    if (existing) {
      toUpdate.push({ n, existingSourceIds: existing.sourceIds, existingState: existing.state });
    } else {
      toInsert.push(normalizedInsertData(n, plan));
    }
  }

  if (toInsert.length > 0) {
    const result = await repo.normalizedJob.createMany({ data: toInsert, skipDuplicates: true });
    stats.normalizedInserted = result.count;
  }
  for (const { n, existingSourceIds, existingState } of toUpdate) {
    await repo.normalizedJob.update({
      where: { canonicalUrl: n.canonicalUrl },
      data: normalizedUpdateData(n, plan, existingSourceIds, existingState, now),
    });
    stats.normalizedUpdated++;
  }
  return stats;
}

/** Structured-geo + state columns shared by the insert and update paths. */
function geoColumns(n: NormalizedJob): Record<string, unknown> {
  const cols: Record<string, unknown> = {
    country: n.country,
    region: n.region,
    city: n.city,
    workplaceType: n.workplaceType,
    remoteScope: n.remoteScope,
    sponsorshipSignal: n.sponsorshipSignal,
    geoParsedAt: n.geoParsedAt,
    compCurrency: n.compCurrency,
    compMin: n.compBandOriginal?.min ?? null,
    compMax: n.compBandOriginal?.max ?? null,
  };
  if (n.sponsorshipEvidence) cols.sponsorshipEvidence = n.sponsorshipEvidence;
  return cols;
}

function promotedState(plan: IngestPlan, n: NormalizedJob): string {
  return plan.stateByWinner.get(n) ?? 'discovered';
}

function normalizedInsertData(n: NormalizedJob, plan: IngestPlan): Record<string, unknown> {
  return {
    canonicalUrl: n.canonicalUrl,
    title: n.title,
    company: n.company,
    location: n.location,
    remote: n.remote,
    ...geoColumns(n),
    state: promotedState(plan, n),
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
  existingState: string,
  now: Date,
): Record<string, unknown> {
  return {
    title: n.title,
    company: n.company,
    location: n.location,
    remote: n.remote,
    ...geoColumns(n),
    // Never downgrade an already-VERIFIED row; otherwise promote from the
    // fresh verify verdict.
    state: existingState === 'verified' ? 'verified' : promotedState(plan, n),
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
    // One search run per market target so every request carries its structured
    // country/location; a target-less profile keeps the legacy global query.
    const targets: Array<MarketTarget | null> = plan.targets.length > 0 ? plan.targets : [null];
    for (const target of targets) {
      if (isFirecrawlKilled(env) || !budget.allow(1)) {
        summary.killed = summary.killed || isFirecrawlKilled(env);
        break;
      }
      const run = await runCandidateSearch({
        client: options.client,
        queries: plan.queries,
        ...(target ? { country: target.country } : {}),
        ...(target?.location ? { location: target.location } : {}),
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

  if (!isFirecrawlConfigured(env)) {
    logger.warn(
      { job: JOB_FIRECRAWL_SEARCH },
      'firecrawl-search: FIRECRAWL_API_KEY unset; skipping',
    );
    await audit(repo, 'job.firecrawl_search.unconfigured', { reason: 'missing-api-key' }, new Date());
    return { skipped: true, reason: 'missing-api-key' };
  }

  const client = deps.createClient
    ? deps.createClient({ env })
    : (createFirecrawlClient({ env }) as unknown as FirecrawlJobClient);

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
