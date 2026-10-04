import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type JobSkillExtraction } from '@careeros/shared';
import { InjectionBlockedError, renderPrompt, wrapUntrusted, type AIProvider } from '@careeros/ai';
import {
  adapters as allAdapters,
  buildCandidateSearchQueries,
  buildMarketSyncRequests,
  createAdzunaAdapter,
  createFirecrawlAdapter,
  freshness,
  relevance,
  planIngest,
  computeMatchResult,
  isEligibleToApply,
  marketTargetsFromProfile,
  MissingCredentialError,
  type EligibilityResult,
  type IngestPlan,
  type JobSourceAdapter,
  type MarketPlan,
  type MarketSyncRequest,
  type NormalizedJob,
  type MatchResult,
  type RawJob,
  type RelevanceSignal,
} from '@careeros/job-pipeline';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { ProviderLoaderService } from '../../common/provider-loader.service';
import { JobPreferencesService } from '../job-prefs/job-prefs.service';

export interface JobsSyncStats {
  adapter: string;
  fetched: number;
  rawInserted: number;
  normalizedInserted: number;
  normalizedUpdated: number;
  /** C-P3.2e: rows that verify() rejected — never entered jobs_normalized, one row each in job_reject_log. */
  rejected: number;
  /** C-P3.2e: rows folded into a higher-tier sibling by crossSourceDedupe. */
  merged: number;
}

export interface JobListItem {
  id: string;
  canonicalUrl: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  primarySource: string;
  state: string;
  sourcePostedAt: string | null;
  firstSeenAt: string;
  skillIds: string[];
  match: MatchResult;
  aging: boolean;
  /** P1 structured geography (null when not parsed). */
  country: string | null;
  region: string | null;
  city: string | null;
  workplaceType: string | null;
  remoteScope: string | null;
  sponsorshipSignal: string;
  /** Soft discovery signals; empty when none apply. */
  signals: RelevanceSignal[];
  /** Two-track apply/recommended gate decision (necessary, not sufficient). */
  eligibility: EligibilityResult;
}

export interface SkillExtractionStats {
  scanned: number;
  extracted: number;
  skipped: number;
  errors: number;
}

/** Reject-reason counts from applying filters + freshness to the fetched pool. */
export interface RejectStats {
  remoteOnly: number;
  mustHaveMissing: number;
  hasDealbreaker: number;
  companyBlacklisted: number;
  stale: number;
  /** How many rows were considered before filtering. Gives the UI honest pool scope. */
  scanned: number;
}

/**
 * Freshness thresholds per blueprint §9 Stage-4. `FRESHNESS_DAYS` is a hard
 * reject; `AGING_DAYS` starts warning the user before the row would fall out.
 * ponytail: constants for the walking-skeleton; per-user override lands with
 * the user-prefs `freshnessDays` column when the settings form exposes it.
 */
const FRESHNESS_DAYS = 45;
const AGING_DAYS = 14;

/**
 * Minimum geo fit for "Recommended for you". A null geoFit (no geo preference
 * configured) passes — there's nothing to fit against.
 */
const MIN_GEO_FIT_FOR_RECOMMENDED = 0.5;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly adapters: Record<string, JobSourceAdapter> = Object.fromEntries(
    allAdapters.map((a) => [a.id, a]),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
    private readonly prefs: JobPreferencesService,
    private readonly providerLoader: ProviderLoaderService,
  ) {}

  listAdapters() {
    return Object.values(this.adapters).map((a) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      licenseHint: a.licenseHint,
      attribution: a.attribution,
    }));
  }

  /**
   * Pipeline ingest: adapter fetch → normalize → cross-source dedupe → verify
   * → persist (jobs_raw append-only + jobs_normalized upsert). Relevance/
   * freshness/match are applied at read time in `list`.
   *
   * ponytail: this still runs inline in the `POST admin/jobs/sync/:adapter`
   * request (fetch + Prisma writes), and skill extraction still runs inline in
   * `POST admin/jobs/extract-skills` (LLM calls). There is no durable
   * jobs-ingest BullMQ queue to hand off to: unlike github/gitlab/embedding,
   * persistence here is coupled to Nest's `PrismaService` and no pure
   * persistence port exists yet. Extracting one is a real refactor, not a
   * half-migration, so it is deferred. The seam is ready: `sync(adapterId)` is
   * request-free and unit-tested against a mocked Prisma, every pure stage
   * (normalize → crossSourceDedupe → verify → relevance → match) lives in
   * `@careeros/job-pipeline`, and a future `QUEUE_JOBS` handler only needs a
   * thin persistence adapter. Do NOT enqueue a job that still calls this same
   * method from the API — that would be the half-migration.
   */
  async sync(adapterId: string, plan?: MarketPlan): Promise<JobsSyncStats> {
    const adapter = this.adapters[adapterId];
    if (!adapter) throw new NotFoundException(`Unknown adapter: ${adapterId}`);

    const requests = buildMarketSyncRequests(adapterId, plan ?? { targets: [] });
    // Legacy path: no market scoping → exactly one request through the shared
    // singleton, preserving byte-for-byte behavior for existing callers.
    if (requests.length <= 1 && !requests[0]?.country) {
      const raws = await adapter.fetch();
      return this.ingest(raws, adapterId, plan);
    }

    const aggregate = emptySyncStats(adapterId);
    for (const request of requests) {
      const marketAdapter = this.buildMarketAdapter(adapterId, request, plan, adapter);
      const raws = await marketAdapter.fetch();
      const stats = await this.ingest(raws, adapterId, plan);
      aggregate.fetched += stats.fetched;
      aggregate.rawInserted += stats.rawInserted;
      aggregate.normalizedInserted += stats.normalizedInserted;
      aggregate.normalizedUpdated += stats.normalizedUpdated;
      aggregate.rejected += stats.rejected;
      aggregate.merged += stats.merged;
    }
    return aggregate;
  }

  /**
   * Construct the adapter for one market request. Adzuna gets `country`/`where`;
   * Firecrawl gets structured `country`/`location` + the plan's queries. Every
   * other adapter has no per-market surface, so the singleton is reused.
   */
  private buildMarketAdapter(
    adapterId: string,
    request: MarketSyncRequest,
    plan: MarketPlan | undefined,
    fallback: JobSourceAdapter,
  ): JobSourceAdapter {
    if (adapterId === 'adzuna' && request.country) {
      return createAdzunaAdapter({
        country: request.country,
        ...(request.location ? { where: request.location } : {}),
      });
    }
    if (adapterId === 'firecrawl' && request.country && (plan?.queries?.length ?? 0) > 0) {
      return createFirecrawlAdapter({
        queries: plan!.queries!,
        country: request.country,
        ...(request.location ? { location: request.location } : {}),
      });
    }
    return fallback;
  }

  /**
   * Scoped sync entry point for `POST admin/jobs/sync/:adapter`. Builds the
   * caller's market plan from their canonical `UserJobPreferences` (the same
   * profile F7/F8 use) and passes it to `sync`, so a market-scoped adapter
   * (Adzuna/Firecrawl) issues the per-market request set instead of one legacy
   * global fetch. Non-scoped adapters fall through unchanged.
   */
  async syncForUser(adapterId: string, userId: string): Promise<JobsSyncStats> {
    const { plan } = await this.buildCandidateSearch(userId);
    return this.sync(adapterId, plan);
  }

  /**
   * F7 candidate-targeted search. Derives bounded Firecrawl queries from the
   * candidate's career goals, job preferences and demonstrated skills, fetches
   * through the Firecrawl adapter (banned platforms filtered, `DISCOVERED`
   * trust kept), then runs the identical ingest funnel as `sync`. A missing
   * Firecrawl key degrades to a clean zero-stat no-op.
   */
  async syncCandidateSearch(
    userId: string,
    adapterOverride?: JobSourceAdapter,
  ): Promise<JobsSyncStats> {
    const stats: JobsSyncStats = {
      adapter: 'firecrawl-search',
      fetched: 0,
      rawInserted: 0,
      normalizedInserted: 0,
      normalizedUpdated: 0,
      rejected: 0,
      merged: 0,
    };
    const { queries, plan } = await this.buildCandidateSearch(userId);
    if (queries.length === 0) {
      this.logger.warn(`candidate ${userId} has no target roles; firecrawl search skipped`);
      return stats;
    }
    if (adapterOverride) {
      let raws: RawJob[];
      try {
        raws = await adapterOverride.fetch();
      } catch (err) {
        if (err instanceof MissingCredentialError) {
          this.logger.warn('firecrawl search skipped: FIRECRAWL_API_KEY not configured');
          return stats;
        }
        throw err;
      }
      return this.ingest(raws, 'firecrawl-search', plan);
    }

    // One adapter per target market so the outbound search request carries the
    // structured `country`/`location` (job-targeting §6).
    const requests = buildMarketSyncRequests('firecrawl', plan);
    const raws: RawJob[] = [];
    try {
      for (const request of requests) {
        const adapter = createFirecrawlAdapter({
          queries,
          ...(request.country ? { country: request.country } : {}),
          ...(request.location ? { location: request.location } : {}),
        });
        raws.push(...(await adapter.fetch()));
      }
    } catch (err) {
      if (err instanceof MissingCredentialError) {
        this.logger.warn('firecrawl search skipped: FIRECRAWL_API_KEY not configured');
        return stats;
      }
      throw err;
    }
    return this.ingest(raws, 'firecrawl-search', plan);
  }

  /**
   * Resolve the canonical targeting profile + demonstrated skills into Firecrawl
   * query strings and a market plan. Reads ONLY `UserJobPreferences` (post-P1
   * unification) — never `CareerGoal.targetRoles/locations`.
   */
  private async buildCandidateSearch(
    userId: string,
  ): Promise<{ queries: string[]; plan: MarketPlan }> {
    const [prefs, skillStates, catalogue] = await Promise.all([
      this.prefs.get(userId),
      this.prisma.candidateSkillState.findMany({
        where: { userId },
        select: { skillId: true, proficiency: true },
        orderBy: { proficiency: 'desc' },
        take: 8,
      }),
      this.prisma.skill.findMany({ select: { id: true, name: true } }),
    ]);
    const nameById = new Map(catalogue.map((s) => [s.id, s.name]));
    const names = (ids: string[]): string[] =>
      ids.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n));

    const queries = buildCandidateSearchQueries({
      targetRoles: prefs.targetRoles,
      locations: prefs.locations,
      remoteOnly: prefs.remoteOnly,
      seniority: prefs.seniority,
      mustHaveSkills: names(prefs.mustHaveSkills),
      dealbreakerSkills: names(prefs.dealbreakerSkills),
      candidateSkills: skillStates
        .map((s) => nameById.get(s.skillId))
        .filter((n): n is string => Boolean(n)),
    });

    const targets = marketTargetsFromProfile({ countries: prefs.countries, cities: prefs.cities });
    return { queries, plan: { targets, queries } };
  }

  /**
   * Shared ingest funnel: append raw → normalize → cross-source dedupe →
   * verify → persist. Relevance/freshness/match stay read-time stages in
   * `list` so preference changes re-evaluate without a re-ingest.
   */
  private async ingest(
    raws: RawJob[],
    adapterId: string,
    _marketPlan?: MarketPlan,
  ): Promise<JobsSyncStats> {
    const stats = emptySyncStats(adapterId);

    stats.fetched = raws.length;
    if (raws.length === 0) {
      this.logger.warn(`adapter ${adapterId} returned 0 jobs; layout may have changed`);
      return stats;
    }

    // C-P3.8b: batch fix. Old shape was 3 sequential Prisma calls per raw
    // (jobRaw.create + normalizedJob.findUnique + create-or-update), which
    // grew to 3000+ round-trips on a 1000-row Remotive sync. New shape is
    // constant round-trips per batch:
    //   1) jobRaw.createMany({ skipDuplicates:true }) — one write for all raws
    //   2) normalizedJob.findMany({ canonicalUrl:in }) — one read for the map
    //   3) normalizedJob.createMany({ skipDuplicates:true }) — one insert
    //   4) N updates for pre-existing rows (unavoidable because `sourceIds`
    //      merge is per-row; still one round-trip each, no per-row read).
    // Total queries: 3 + (existing-row count). For a fresh Remotive sync
    // (all inserts) that's 3 queries regardless of pool size.
    //
    // ponytail: keeping the per-existing-row `update` because merging
    // `sourceIds` with `uniq([...existing, new])` needs the old value. When
    // this stops being the bottleneck we can push it to `UPDATE ... SET
    // source_ids = array(SELECT DISTINCT unnest(source_ids || $new))` in a
    // single raw query, but a single-adapter deployment rarely re-syncs the
    // same URL, so today the update path is a small tail on a fresh sync.

    // jobs_raw is append-only per AGENTS.md rule (never overwrite). No
    // unique constraint on (source, sourceId) today, so every re-sync
    // appends a fresh fetch row — that's the intended provenance log.
    const rawRows = raws.map((r) => ({
      source: r.sourceName,
      sourceId: r.sourceId,
      canonicalUrl: r.canonicalUrl,
      payload: r.payload as Prisma.InputJsonValue,
      fetchedAt: r.fetchedAt,
    }));
    const rawResult = await this.prisma.jobRaw.createMany({ data: rawRows });
    stats.rawInserted = rawResult.count;

    // C-P3.2e wiring: normalize → cross-source fuzzy dedupe → verify. Shared
    // with the F8 worker via `planIngest` so the API and cron paths cannot
    // diverge. Rejected rows never touch jobs_normalized; every rejected row
    // lands as one job_reject_log row for the reject-audit UI. Flagged +
    // trusted continue into the existing N+1-safe upsert flow.
    const now = new Date();
    const plan = planIngest(raws, { now });
    stats.merged = plan.duplicates.length;

    const rejectRows: Prisma.JobRejectLogCreateManyInput[] = plan.rejected.map((r) => ({
      jobRawId: null,
      sourceId: r.sourceId,
      sourceName: r.sourceName,
      reason: r.reason,
      verdict: 'rejected',
      details: r.details as Prisma.InputJsonValue,
    }));
    const survivors: NormalizedJob[] = plan.normalized;
    // Fold merged loser sourceTags onto each survivor before persist.
    // ponytail: this stage-owned merged-tag map is per-batch; the existing-row
    // update path re-merges with the DB-side sourceIds below to cover the case
    // where the same URL was persisted in a prior sync.
    const mergedTags = plan.mergedSourceTagsByWinner;

    if (rejectRows.length > 0) {
      await this.prisma.jobRejectLog.createMany({ data: rejectRows });
      stats.rejected = rejectRows.length;
    }

    if (survivors.length === 0) return stats;

    const canonicalUrls = survivors.map((n) => n.canonicalUrl);
    const existingRows = await this.prisma.normalizedJob.findMany({
      where: { canonicalUrl: { in: canonicalUrls } },
      select: { canonicalUrl: true, sourceIds: true, state: true },
    });
    const existingByUrl = new Map(existingRows.map((row) => [row.canonicalUrl, row]));

    const toInsert: Prisma.NormalizedJobCreateManyInput[] = [];
    const toUpdate: Array<{
      n: NormalizedJob;
      existingSourceIds: string[];
      existingState: string;
    }> = [];
    for (const n of survivors) {
      // Accumulated in-batch sourceIds from cross-source-dedupe (includes the
      // winner's own tag + every merged loser's tag). Falls back to just the
      // winner's own tag if the map lookup misses (shouldn't happen, but
      // safe).
      const batchTags = mergedTags.get(n) ?? [n.sourceTag];
      const existing = existingByUrl.get(n.canonicalUrl);
      if (existing) {
        toUpdate.push({
          n,
          existingSourceIds: existing.sourceIds,
          existingState: existing.state,
        });
      } else {
        toInsert.push({
          canonicalUrl: n.canonicalUrl,
          title: n.title,
          company: n.company,
          location: n.location,
          remote: n.remote,
          ...geoPersistFields(n),
          state: promotedStateFor(plan, n),
          description: n.description,
          sourcePostedAt: n.sourcePostedAt,
          primarySource: n.primarySource,
          sourceIds: batchTags,
        });
      }
    }

    if (toInsert.length > 0) {
      const insertResult = await this.prisma.normalizedJob.createMany({
        data: toInsert,
        skipDuplicates: true,
      });
      stats.normalizedInserted = insertResult.count;
    }

    for (const { n, existingSourceIds, existingState } of toUpdate) {
      const batchTags = mergedTags.get(n) ?? [n.sourceTag];
      await this.prisma.normalizedJob.update({
        where: { canonicalUrl: n.canonicalUrl },
        data: {
          title: n.title,
          company: n.company,
          location: n.location,
          remote: n.remote,
          ...geoPersistFields(n),
          // Never downgrade an already-VERIFIED row; otherwise promote from the
          // fresh verify verdict (job-targeting §5).
          state: existingState === 'verified' ? 'verified' : promotedStateFor(plan, n),
          description: n.description,
          sourcePostedAt: n.sourcePostedAt,
          lastVerifiedAt: now,
          sourceIds: uniq([...existingSourceIds, ...batchTags]),
        },
      });
      stats.normalizedUpdated++;
    }
    return stats;
  }

  async list(params: {
    userId: string;
    limit: number;
    offset: number;
    skill?: string;
  }): Promise<{ jobs: JobListItem[]; total: number; rejected: RejectStats }> {
    const limit = Math.max(1, Math.min(params.limit, 200));
    const offset = Math.max(0, params.offset);
    const where: Prisma.NormalizedJobWhereInput = params.skill
      ? { skillIds: { has: params.skill } }
      : {};

    const ranked = await this.loadRankedJobs(params.userId, where, {
      // Over-fetch so we can score-then-sort client-side; DB can't sort by a
      // computed match without materializing per-user scores.
      // ponytail: acceptable up to ~2k jobs and offset < ~1k; precompute +
      // `user_job_match` lands when either ceiling is hit.
      take: Math.max(limit, limit + offset) * 2,
    });
    return {
      total: ranked.total,
      rejected: ranked.rejected,
      jobs: ranked.jobs.slice(offset, offset + limit),
    };
  }

  /**
   * P1 "Recommended for you": the two-track eligibility gate plus a geo-fit
   * threshold over the same ranked pool as `list`. Eligibility stays necessary,
   * not sufficient — the approval queue still gates every submission.
   */
  async recommended(params: { userId: string; limit: number }): Promise<JobListItem[]> {
    const limit = Math.max(1, Math.min(params.limit, 200));
    const ranked = await this.loadRankedJobs(params.userId, {}, { take: limit * 4 });
    return ranked.jobs
      .filter((j) => j.eligibility.eligible && (j.match.geoFit ?? 1) >= MIN_GEO_FIT_FOR_RECOMMENDED)
      .slice(0, limit);
  }

  /**
   * Shared list/recommended pipeline: freshness + relevance → match (with geo
   * and comp fit) → eligibility. One batched read per call.
   */
  private async loadRankedJobs(
    userId: string,
    where: Prisma.NormalizedJobWhereInput,
    opts: { take: number },
  ): Promise<{ total: number; rejected: RejectStats; jobs: JobListItem[] }> {
    const [rows, total, skillStates, prefs] = await Promise.all([
      this.prisma.normalizedJob.findMany({
        where,
        orderBy: [{ sourcePostedAt: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
        take: opts.take,
      }),
      this.prisma.normalizedJob.count({ where }),
      this.prisma.candidateSkillState.findMany({
        where: { userId },
        select: { skillId: true, proficiency: true, recencyDays: true },
      }),
      this.prefs.get(userId),
    ]);
    const stateBySkill = new Map(
      skillStates.map((s) => [
        s.skillId,
        { proficiency: s.proficiency, recencyDays: s.recencyDays },
      ]),
    );
    const eligibilityProfile = {
      homeCountry: prefs.homeCountry ?? null,
      citizenships: prefs.citizenships,
      workAuthorizations: prefs.workAuthorizations,
      sponsorshipCountries: prefs.sponsorshipCountries,
    };

    const rejected: RejectStats = {
      remoteOnly: 0,
      mustHaveMissing: 0,
      hasDealbreaker: 0,
      companyBlacklisted: 0,
      stale: 0,
      scanned: rows.length,
    };
    const nowMs = Date.now();
    // Narrow nullable optional to `T | null` so the DTO satisfies RelevancePrefs
    // under exactOptionalPropertyTypes.
    const relevancePrefs = {
      ...prefs,
      homeCountry: prefs.homeCountry ?? null,
      compMin: prefs.compMin ?? null,
      compMax: prefs.compMax ?? null,
    };
    const filtered: Array<{ row: (typeof rows)[number]; signals: RelevanceSignal[] }> = [];
    for (const r of rows) {
      const result = relevance(
        {
          company: r.company,
          remote: r.remote,
          skillIds: r.skillIds,
          sourcePostedAt: r.sourcePostedAt,
          firstSeenAt: r.firstSeenAt,
          country: r.country,
          region: r.region,
          workplaceType: r.workplaceType,
          remoteScope: r.remoteScope,
          sponsorshipSignal: r.sponsorshipSignal,
          compCurrency: r.compCurrency,
        },
        relevancePrefs,
        { maxAgeDays: FRESHNESS_DAYS, now: nowMs },
      );
      if (!result.relevant) {
        switch (result.reason) {
          case 'stale':
            rejected.stale++;
            break;
          case 'remote-only':
            rejected.remoteOnly++;
            break;
          case 'company-blacklisted':
            rejected.companyBlacklisted++;
            break;
          case 'has-dealbreaker':
            rejected.hasDealbreaker++;
            break;
          case 'must-have-missing':
            rejected.mustHaveMissing++;
            break;
        }
        continue;
      }
      filtered.push({ row: r, signals: result.signals ?? [] });
    }

    const scored = filtered.map(({ row: r, signals }) => {
      const match = computeMatchResult({
        jobId: r.id,
        required: r.skillIds.map((skillId) => ({ skillId, weight: 1 })),
        nameById: new Map(),
        stateBySkill,
        evidenceBySkill: new Map(),
        geo: {
          job: {
            country: r.country,
            region: r.region,
            workplaceType: r.workplaceType,
            remoteScope: r.remoteScope,
          },
          profile: {
            countries: prefs.countries,
            workplaceTypes: prefs.workplaceTypes,
            remoteScopes: prefs.remoteScopes,
          },
        },
        comp: {
          job: { currency: r.compCurrency, min: r.compMin, max: r.compMax },
          profile: {
            currency: prefs.currency,
            min: prefs.compMin ?? null,
            max: prefs.compMax ?? null,
          },
        },
      });
      const f = freshness(
        { sourcePostedAt: r.sourcePostedAt, firstSeenAt: r.firstSeenAt },
        { maxAgeDays: FRESHNESS_DAYS, agingDays: AGING_DAYS, now: nowMs },
      );
      const item: JobListItem = {
        id: r.id,
        canonicalUrl: r.canonicalUrl,
        title: r.title,
        company: r.company,
        location: r.location,
        remote: r.remote,
        primarySource: r.primarySource,
        state: r.state,
        sourcePostedAt: r.sourcePostedAt?.toISOString() ?? null,
        firstSeenAt: r.firstSeenAt.toISOString(),
        skillIds: r.skillIds,
        match,
        aging: f.reason === 'aging',
        country: r.country,
        region: r.region,
        city: r.city,
        workplaceType: r.workplaceType,
        remoteScope: r.remoteScope,
        sponsorshipSignal: r.sponsorshipSignal,
        signals,
        eligibility: isEligibleToApply(eligibilityProfile, {
          state: r.state,
          country: r.country,
          sponsorshipSignal: r.sponsorshipSignal,
        }),
      };
      return item;
    });
    // Sort by match score DESC (nulls last), then geo fit as a tiebreak.
    scored.sort((a, b) => {
      const as = a.match.score;
      const bs = b.match.score;
      if (as !== bs) {
        if (as === null) return 1;
        if (bs === null) return -1;
        return bs - as;
      }
      return (b.match.geoFit ?? -1) - (a.match.geoFit ?? -1);
    });
    return { total, rejected, jobs: scored };
  }

  /**
   * Run LLM skill extraction on jobs whose `skillIds` is still empty. Batched:
   * one LLM call per job, skip on failure so a single bad row doesn't stall
   * the batch. Returns stats for the sync UI. Sensitivity=`public` — public
   * job listings are not personal/employer-confidential data.
   */
  async extractSkillsBatch(userId: string, limit: number): Promise<SkillExtractionStats> {
    const clamped = Math.max(1, Math.min(limit, 100));
    const stats: SkillExtractionStats = { scanned: 0, extracted: 0, skipped: 0, errors: 0 };

    const jobs = await this.prisma.normalizedJob.findMany({
      where: { skillsExtractedAt: null },
      orderBy: { firstSeenAt: 'desc' },
      take: clamped,
    });
    stats.scanned = jobs.length;
    if (jobs.length === 0) return stats;

    const provider = await this.tryLoadProvider(userId);
    if (!provider) throw new BadRequestException('LLM provider not configured or paused');

    const catalogue = await this.prisma.skill.findMany({ select: { id: true, name: true } });
    if (catalogue.length === 0) {
      this.logger.warn('skill catalogue empty; extraction is a no-op. Run the worker seed first.');
      return stats;
    }
    const knownIds = new Set(catalogue.map((s) => s.id));
    const catalogueRendered = catalogue.map((s) => `- ${s.id} (${s.name})`).join('\n');

    for (const job of jobs) {
      try {
        const extracted = await this.extractSkillsForOne(userId, provider, job, catalogueRendered);
        const validIds = extracted.skillIds.filter((id) => knownIds.has(id));
        await this.prisma.normalizedJob.update({
          where: { id: job.id },
          data: { skillIds: validIds, skillsExtractedAt: new Date() },
        });
        stats.extracted++;
      } catch (err) {
        // C-P3.7a: blocked injection audits + skips (per ai-safety.md item 5)
        // so a single poisoned JD never sinks the whole batch. Non-injection
        // errors still bump `errors`; the tail recomputation of `skipped`
        // below folds injection-blocked jobs into the skipped bucket.
        if (err instanceof InjectionBlockedError) {
          await this.auditInjectionBlocked(userId, job.id, err);
          continue;
        }
        this.logger.warn(`skill extraction failed for job ${job.id}: ${(err as Error).message}`);
        stats.errors++;
      }
    }
    stats.skipped = stats.scanned - stats.extracted - stats.errors;
    return stats;
  }

  async extractSkillsForJob(userId: string, jobId: string): Promise<{ skillIds: string[] }> {
    const job = await this.prisma.normalizedJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    const provider = await this.tryLoadProvider(userId);
    if (!provider) throw new BadRequestException('LLM provider not configured or paused');
    const catalogue = await this.prisma.skill.findMany({ select: { id: true, name: true } });
    const knownIds = new Set(catalogue.map((s) => s.id));
    const catalogueRendered = catalogue.map((s) => `- ${s.id} (${s.name})`).join('\n');
    let extracted: JobSkillExtraction;
    try {
      extracted = await this.extractSkillsForOne(userId, provider, job, catalogueRendered);
    } catch (err) {
      // C-P3.7a: single-job path returns 400 rather than 500 on a poisoned JD,
      // and audits `security.audit.injection_blocked` so the operator can review.
      if (err instanceof InjectionBlockedError) {
        await this.auditInjectionBlocked(userId, job.id, err);
        throw new BadRequestException(
          'Job description contains prompt-injection markers; skill extraction refused.',
        );
      }
      throw err;
    }
    const validIds = extracted.skillIds.filter((id) => knownIds.has(id));
    await this.prisma.normalizedJob.update({
      where: { id: job.id },
      data: { skillIds: validIds, skillsExtractedAt: new Date() },
    });
    return { skillIds: validIds };
  }

  /**
   * C-P3.7a: dedicated audit row per blocked ingest. `action` string matches
   * the code emitted by `wrapUntrusted`'s audit hook (ai-safety.md item 5) so
   * downstream dashboards can group both sources of the same event.
   */
  private async auditInjectionBlocked(
    userId: string,
    jobId: string,
    err: InjectionBlockedError,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'system',
          action: 'security.audit.injection_blocked',
          resourceType: 'normalized_job',
          resourceId: jobId,
          payload: { jobId, source: 'job-description', kinds: err.hits },
        },
      })
      .catch(() => {
        /* audit must not throw */
      });
  }

  private async extractSkillsForOne(
    userId: string,
    provider: AIProvider,
    job: { title: string; company: string; description: string },
    catalogueRendered: string,
  ): Promise<JobSkillExtraction> {
    const wrapped = wrapUntrusted(job.description, 'job-description', { userId });
    const rendered = renderPrompt('job-skill-extract', {
      catalogue: catalogueRendered,
      title: job.title,
      company: job.company,
      description: wrapped.content,
    });
    // A-M9: per-user LLM concurrency ceiling.
    return (await this.usage.runWithUserLimit(userId, () =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        schema: rendered.schema,
        temperature: 0,
        meta: {
          promptId: rendered.id,
          promptVersion: rendered.version,
          promptHash: rendered.hash,
          sensitivity: 'public',
        },
      }),
    )) as JobSkillExtraction;
  }

  /**
   * Gates at `public` sensitivity; returns null on any failure so callers can
   * decide what to do. The budget/config/gate/decrypt sequence lives in
   * `ProviderLoaderService`; this wrapper only keeps the jobs-specific log and
   * null handling.
   */
  private async tryLoadProvider(userId: string): Promise<AIProvider | null> {
    try {
      const loaded = await this.providerLoader.loadProviderForUser(userId, 'public');
      return loaded?.provider ?? null;
    } catch (err) {
      this.logger.warn(`jobs: provider unavailable: ${(err as Error).message}`);
      return null;
    }
  }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/** Zeroed sync stats with the adapter id filled in. */
function emptySyncStats(adapterId: string): JobsSyncStats {
  return {
    adapter: adapterId,
    fetched: 0,
    rawInserted: 0,
    normalizedInserted: 0,
    normalizedUpdated: 0,
    rejected: 0,
    merged: 0,
  };
}

/** Pipeline state promoted from the verify verdict for one survivor. */
function promotedStateFor(plan: IngestPlan, n: NormalizedJob): string {
  return plan.stateByWinner.get(n) ?? 'discovered';
}

/**
 * Structured-geo columns for one normalized job. `sponsorshipEvidence` is only
 * included when the signal is not `unclear`, so Prisma's nullable-JSON default
 * stays in place otherwise.
 */
function geoPersistFields(n: NormalizedJob): {
  country: string | null;
  region: string | null;
  city: string | null;
  workplaceType: string | null;
  remoteScope: string | null;
  sponsorshipSignal: NormalizedJob['sponsorshipSignal'];
  geoParsedAt: Date;
  compCurrency: string | null;
  compMin: number | null;
  compMax: number | null;
  sponsorshipEvidence?: Prisma.InputJsonValue;
} {
  const fields: ReturnType<typeof geoPersistFields> = {
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
  if (n.sponsorshipEvidence) {
    fields.sponsorshipEvidence = n.sponsorshipEvidence as unknown as Prisma.InputJsonValue;
  }
  return fields;
}
