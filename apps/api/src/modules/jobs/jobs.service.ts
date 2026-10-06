import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type JobSkillExtraction } from '@careeros/shared';
import { InjectionBlockedError, renderPrompt, wrapUntrusted, type AIProvider } from '@careeros/ai';
import {
  adapters as allAdapters,
  buildCandidateSearchQueries,
  createConfiguredAdapter,
  createFirecrawlAdapter,
  freshness,
  relevance,
  planIngest,
  computeMatchResult,
  titleMatchesRoles,
  MissingCredentialError,
  type JobSourceAdapter,
  type NormalizedJob,
  type MatchResult,
  type RawJob,
} from '@careeros/job-pipeline';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { ProviderLoaderService } from '../../common/provider-loader.service';
import { ProviderConfigService } from '../../common/provider-config.service';
import { JobPreferencesService } from '../job-prefs/job-prefs.service';
import { resolveSkillNamesToIds } from '../skills/skill-name-resolver';

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
  roleMismatch: number;
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
    private readonly providerConfig: ProviderConfigService,
  ) {}

  /**
   * Resolve the adapter to run: the DB-configured instance when credentials are
   * stored, else the env-reading default from the registry. Config errors fall
   * back to the default rather than failing the sync.
   */
  private async configuredAdapter(
    adapterId: string,
    fallback: JobSourceAdapter,
  ): Promise<JobSourceAdapter> {
    try {
      const creds = await this.providerConfig.resolve(adapterId);
      return createConfiguredAdapter(adapterId, creds) ?? fallback;
    } catch (err) {
      this.logger.warn(
        `jobs: provider config for ${adapterId} unavailable, using default: ${(err as Error).message}`,
      );
      return fallback;
    }
  }

  /** Firecrawl API key from the DB config, else env. undefined when neither is set. */
  private async firecrawlApiKey(): Promise<string | undefined> {
    try {
      const creds = await this.providerConfig.resolve('firecrawl');
      return creds.secrets['apiKey']?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

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
  async sync(adapterId: string): Promise<JobsSyncStats> {
    const base = this.adapters[adapterId];
    if (!base) throw new NotFoundException(`Unknown adapter: ${adapterId}`);
    const adapter = await this.configuredAdapter(adapterId, base);
    const raws = await adapter.fetch();
    return this.ingest(raws, adapterId);
  }

  /**
   * F7 candidate-targeted search. Derives bounded Firecrawl queries from the
   * candidate's career goals, job preferences and demonstrated skills, fetches
   * through the Firecrawl adapter (`DISCOVERED` trust kept; LinkedIn/Indeed/
   * Naukri/Glassdoor permitted via Firecrawl per owner decision 2026-10-06),
   * then runs the identical ingest funnel as `sync`. A missing Firecrawl key
   * degrades to a clean zero-stat no-op.
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
    const queries = await this.buildCandidateQueries(userId);
    if (queries.length === 0) {
      this.logger.warn(`candidate ${userId} has no target roles; firecrawl search skipped`);
      return stats;
    }
    const apiKey = await this.firecrawlApiKey();
    const adapter =
      adapterOverride ?? createFirecrawlAdapter({ queries, ...(apiKey ? { apiKey } : {}) });
    let raws: RawJob[];
    try {
      raws = await adapter.fetch();
    } catch (err) {
      if (err instanceof MissingCredentialError) {
        this.logger.warn('firecrawl search skipped: FIRECRAWL_API_KEY not configured');
        return stats;
      }
      throw err;
    }
    return this.ingest(raws, 'firecrawl-search');
  }

  /** Resolve goal + prefs + skills into Firecrawl query strings. */
  private async buildCandidateQueries(userId: string): Promise<string[]> {
    const [goal, prefs, skillStates, catalogue] = await Promise.all([
      this.prisma.careerGoal.findUnique({ where: { userId } }),
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

    return buildCandidateSearchQueries({
      targetRoles: prefs.targetRoles.length > 0 ? prefs.targetRoles : (goal?.targetRoles ?? []),
      locations: prefs.locations.length > 0 ? prefs.locations : (goal?.locations ?? []),
      remoteOnly: (goal?.remoteOnly ?? false) || prefs.remoteOnly,
      seniority: goal?.seniority ?? [],
      mustHaveSkills: names(prefs.mustHaveSkills),
      dealbreakerSkills: names(prefs.dealbreakerSkills),
      candidateSkills: skillStates
        .map((s) => nameById.get(s.skillId))
        .filter((n): n is string => Boolean(n)),
    });
  }

  /**
   * Shared ingest funnel: append raw → normalize → cross-source dedupe →
   * verify → persist. Relevance/freshness/match stay read-time stages in
   * `list` so preference changes re-evaluate without a re-ingest.
   */
  private async ingest(raws: RawJob[], adapterId: string): Promise<JobsSyncStats> {
    const stats: JobsSyncStats = {
      adapter: adapterId,
      fetched: 0,
      rawInserted: 0,
      normalizedInserted: 0,
      normalizedUpdated: 0,
      rejected: 0,
      merged: 0,
    };

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
    const plan = planIngest(raws);
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
      select: { canonicalUrl: true, sourceIds: true },
    });
    const existingByUrl = new Map(existingRows.map((row) => [row.canonicalUrl, row]));

    const toInsert: Prisma.NormalizedJobCreateManyInput[] = [];
    const toUpdate: Array<{ n: NormalizedJob; existingSourceIds: string[] }> = [];
    for (const n of survivors) {
      // Accumulated in-batch sourceIds from cross-source-dedupe (includes the
      // winner's own tag + every merged loser's tag). Falls back to just the
      // winner's own tag if the map lookup misses (shouldn't happen, but
      // safe).
      const batchTags = mergedTags.get(n) ?? [n.sourceTag];
      const existing = existingByUrl.get(n.canonicalUrl);
      if (existing) {
        toUpdate.push({ n, existingSourceIds: existing.sourceIds });
      } else {
        toInsert.push({
          canonicalUrl: n.canonicalUrl,
          title: n.title,
          company: n.company,
          location: n.location,
          remote: n.remote,
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

    const now = new Date();
    for (const { n, existingSourceIds } of toUpdate) {
      const batchTags = mergedTags.get(n) ?? [n.sourceTag];
      await this.prisma.normalizedJob.update({
        where: { canonicalUrl: n.canonicalUrl },
        data: {
          title: n.title,
          company: n.company,
          location: n.location,
          remote: n.remote,
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

    // Load candidate skill states (proficiency + recency) for match scoring.
    // Same set and same canonical scorer as MatcherService.scoreJob, so the
    // list score and the detail score cannot diverge for one job/candidate.
    // One batched read per request — constant regardless of page size.
    const [rows, total, skillStates, prefs] = await Promise.all([
      this.prisma.normalizedJob.findMany({
        where,
        orderBy: [{ sourcePostedAt: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
        // Over-fetch so we can score-then-sort client-side in this method; DB
        // can't sort by a computed match without materializing per-user scores.
        // ponytail: acceptable up to ~2k jobs and offset < ~1k; precompute +
        // `user_job_match` lands when either ceiling is hit.
        take: Math.max(limit, limit + offset) * 2,
      }),
      this.prisma.normalizedJob.count({ where }),
      this.prisma.candidateSkillState.findMany({
        where: { userId: params.userId },
        select: { skillId: true, proficiency: true, recencyDays: true },
      }),
      this.prefs.get(params.userId),
    ]);
    const stateBySkill = new Map(
      skillStates.map((s) => [
        s.skillId,
        { proficiency: s.proficiency, recencyDays: s.recencyDays },
      ]),
    );

    const rejected: RejectStats = {
      remoteOnly: 0,
      mustHaveMissing: 0,
      hasDealbreaker: 0,
      companyBlacklisted: 0,
      roleMismatch: 0,
      stale: 0,
      scanned: rows.length,
    };
    const nowMs = Date.now();
    const filtered = rows.filter((r) => {
      const result = relevance(
        {
          company: r.company,
          remote: r.remote,
          skillIds: r.skillIds,
          sourcePostedAt: r.sourcePostedAt,
          firstSeenAt: r.firstSeenAt,
        },
        prefs,
        { maxAgeDays: FRESHNESS_DAYS, now: nowMs },
      );
      if (result.relevant) {
        // Drop titles unrelated to the candidate's target roles. "Similar" is
        // fine; clearly different functions (finance, account exec, marketing)
        // are not. No-op when the user hasn't set target roles.
        if (
          (prefs.targetRoles?.length ?? 0) > 0 &&
          !titleMatchesRoles(r.title, prefs.targetRoles ?? [])
        ) {
          rejected.roleMismatch++;
          return false;
        }
        return true;
      }
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
      return false;
    });

    const scored = filtered.map((r) => ({
      row: r,
      match: computeMatchResult({
        jobId: r.id,
        required: r.skillIds.map((skillId) => ({ skillId, weight: 1 })),
        nameById: new Map(),
        stateBySkill,
        evidenceBySkill: new Map(),
      }),
    }));
    // Sort by match score DESC (nulls last), then existing tiebreak.
    scored.sort((a, b) => {
      const as = a.match.score;
      const bs = b.match.score;
      if (as === bs) return 0;
      if (as === null) return 1;
      if (bs === null) return -1;
      return bs - as;
    });
    const paged = scored.slice(offset, offset + limit);

    return {
      total,
      rejected,
      jobs: paged.map(({ row: r, match }) => {
        const f = freshness(
          { sourcePostedAt: r.sourcePostedAt, firstSeenAt: r.firstSeenAt },
          { maxAgeDays: FRESHNESS_DAYS, agingDays: AGING_DAYS, now: nowMs },
        );
        const aging = f.reason === 'aging';
        return {
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
          aging,
        };
      }),
    };
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
    const catalogueRendered = catalogue.map((s) => `- ${s.id} (${s.name})`).join('\n');

    for (const job of jobs) {
      try {
        const extracted = await this.extractSkillsForOne(userId, provider, job, catalogueRendered);
        // The model may return catalogue *names* rather than ids; resolve either,
        // drop unknowns. Without this, name-shaped output was silently discarded.
        const validIds = resolveSkillNamesToIds(extracted.skillIds, catalogue);
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
    const validIds = resolveSkillNamesToIds(extracted.skillIds, catalogue);
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
