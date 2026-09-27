import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { matchScoreForJob, type JobSkillExtraction, type MatchResult } from '@careeros/shared';
import { DeepSeekProvider, renderPrompt, wrapUntrusted } from '@careeros/ai';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { remotiveAdapter, type JobSourceAdapter, type RawJob } from '@careeros/job-pipeline';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { makeLlmAuditor } from '../../common/llm-audit';
import { JobPreferencesService } from '../job-prefs/job-prefs.service';

const KEY = loadMasterKey();

export interface JobsSyncStats {
  adapter: string;
  fetched: number;
  rawInserted: number;
  normalizedInserted: number;
  normalizedUpdated: number;
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
const DAY_MS = 86_400_000;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly adapters: Record<string, JobSourceAdapter> = {
    [remotiveAdapter.id]: remotiveAdapter,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
    private readonly prefs: JobPreferencesService,
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
   * Walking-skeleton pipeline: fetch → append to jobs_raw → upsert into
   * jobs_normalized by canonicalUrl. Deferred to later slices: cross-source
   * fuzzy dedupe, skill extraction, verification-state transitions, freshness
   * gate, relevance filter, match score. Everything lands as `unverified` for now.
   */
  async sync(adapterId: string): Promise<JobsSyncStats> {
    const adapter = this.adapters[adapterId];
    if (!adapter) throw new NotFoundException(`Unknown adapter: ${adapterId}`);

    const stats: JobsSyncStats = {
      adapter: adapterId,
      fetched: 0,
      rawInserted: 0,
      normalizedInserted: 0,
      normalizedUpdated: 0,
    };

    const raws = await adapter.fetch();
    stats.fetched = raws.length;
    if (raws.length === 0) {
      this.logger.warn(`adapter ${adapterId} returned 0 jobs; layout may have changed`);
      return stats;
    }

    for (const r of raws) {
      // jobs_raw is append-only per AGENTS.md rule (never overwrite).
      await this.prisma.jobRaw.create({
        data: {
          source: r.sourceName,
          sourceId: r.sourceId,
          canonicalUrl: r.canonicalUrl,
          payload: r.payload as Prisma.InputJsonValue,
          fetchedAt: r.fetchedAt,
        },
      });
      stats.rawInserted++;

      const existing = await this.prisma.normalizedJob.findUnique({
        where: { canonicalUrl: r.canonicalUrl },
      });
      const sourceTag = `${r.sourceName}:${r.sourceId}`;
      if (existing) {
        await this.prisma.normalizedJob.update({
          where: { canonicalUrl: r.canonicalUrl },
          data: {
            title: r.title,
            company: r.company,
            location: r.location,
            remote: r.remote,
            description: r.description,
            sourcePostedAt: r.sourcePostedAt,
            lastVerifiedAt: new Date(),
            sourceIds: uniq([...existing.sourceIds, sourceTag]),
          },
        });
        stats.normalizedUpdated++;
      } else {
        await this.prisma.normalizedJob.create({
          data: {
            canonicalUrl: r.canonicalUrl,
            title: r.title,
            company: r.company,
            location: r.location,
            remote: r.remote,
            description: r.description,
            sourcePostedAt: r.sourcePostedAt,
            primarySource: r.sourceName,
            sourceIds: [sourceTag],
          },
        });
        stats.normalizedInserted++;
      }
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

    // Load user's PROVEN skills for match scoring. `historicalDemonstrated` is
    // the monotonic "was ever proven" flag maintained by the aggregator, which
    // gives an honest signal (a single stray self-claim in Evidence would NOT
    // set it). If the aggregator hasn't run, matches will be conservative rather
    // than inflated — the right failure mode.
    const [rows, total, provenSkills, prefs] = await Promise.all([
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
        where: { userId: params.userId, historicalDemonstrated: true },
        select: { skillId: true },
      }),
      this.prefs.get(params.userId),
    ]);
    const userSkillIds = provenSkills.map((e) => e.skillId);

    const rejected: RejectStats = {
      remoteOnly: 0,
      mustHaveMissing: 0,
      hasDealbreaker: 0,
      companyBlacklisted: 0,
      stale: 0,
      scanned: rows.length,
    };
    const blacklistLower = new Set(prefs.companyBlacklist.map((c) => c.toLowerCase().trim()));
    const mustHave = new Set(prefs.mustHaveSkills);
    const dealbreakers = new Set(prefs.dealbreakerSkills);
    const nowMs = Date.now();
    const staleCutoff = nowMs - FRESHNESS_DAYS * DAY_MS;
    const filtered = rows.filter((r) => {
      const postedMs = (r.sourcePostedAt ?? r.firstSeenAt).getTime();
      if (postedMs < staleCutoff) {
        rejected.stale++;
        return false;
      }
      if (prefs.remoteOnly && !r.remote) {
        rejected.remoteOnly++;
        return false;
      }
      if (blacklistLower.has(r.company.toLowerCase().trim())) {
        rejected.companyBlacklisted++;
        return false;
      }
      const jobSkills = new Set(r.skillIds);
      if (dealbreakers.size > 0) {
        for (const d of dealbreakers) if (jobSkills.has(d)) {
          rejected.hasDealbreaker++;
          return false;
        }
      }
      if (mustHave.size > 0) {
        for (const m of mustHave) if (!jobSkills.has(m)) {
          rejected.mustHaveMissing++;
          return false;
        }
      }
      return true;
    });

    const scored = filtered.map((r) => ({
      row: r,
      match: matchScoreForJob(userSkillIds, r.skillIds),
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
        const postedMs = (r.sourcePostedAt ?? r.firstSeenAt).getTime();
        const aging = nowMs - postedMs > AGING_DAYS * DAY_MS;
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
    const knownIds = new Set(catalogue.map((s) => s.id));
    const catalogueRendered = catalogue.map((s) => `- ${s.id} (${s.name})`).join('\n');

    for (const job of jobs) {
      try {
        const extracted = await this.extractSkillsForOne(provider, job, catalogueRendered);
        const validIds = extracted.skillIds.filter((id) => knownIds.has(id));
        await this.prisma.normalizedJob.update({
          where: { id: job.id },
          data: { skillIds: validIds, skillsExtractedAt: new Date() },
        });
        stats.extracted++;
      } catch (err) {
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
    const extracted = await this.extractSkillsForOne(provider, job, catalogueRendered);
    const validIds = extracted.skillIds.filter((id) => knownIds.has(id));
    await this.prisma.normalizedJob.update({
      where: { id: job.id },
      data: { skillIds: validIds, skillsExtractedAt: new Date() },
    });
    return { skillIds: validIds };
  }

  private async extractSkillsForOne(
    provider: DeepSeekProvider,
    job: { title: string; company: string; description: string },
    catalogueRendered: string,
  ): Promise<JobSkillExtraction> {
    const wrapped = wrapUntrusted(job.description, 'job-description');
    const rendered = renderPrompt('job-skill-extract', {
      catalogue: catalogueRendered,
      title: job.title,
      company: job.company,
      description: wrapped.content,
    });
    return (await provider.chatStructured({
      messages: [
        { role: 'system', content: rendered.system },
        { role: 'user', content: rendered.user },
      ],
      schema: rendered.schema,
      temperature: 0,
    })) as JobSkillExtraction;
  }

  /**
   * Same shape as `CorpusService.tryLoadProvider` — gates at `public`
   * sensitivity, returns null on any failure so callers can decide what to do.
   * Kept inline pending a third caller that would justify extracting a shared
   * `packages/ai/tryLoadUserProvider` helper.
   */
  private async tryLoadProvider(userId: string): Promise<DeepSeekProvider | null> {
    try {
      await this.usage.assertCallAllowed(userId);
      const cfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!cfg || cfg.provider !== 'deepseek') return null;
      await this.sensitivity.assertAllowed(cfg.provider, 'public', userId);
      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: cfg.apiKeySecretId },
      });
      if (!secret) return null;
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);
      return new DeepSeekProvider({
        apiKey,
        baseUrl: cfg.baseUrl ?? undefined,
        chatModel: cfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      });
    } catch (err) {
      this.logger.warn(`jobs: provider unavailable: ${(err as Error).message}`);
      return null;
    }
  }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
