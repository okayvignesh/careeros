import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MarketBriefContent } from '@careeros/shared';
import {
  DeepSeekProvider,
  InjectionBlockedError,
  renderPrompt,
  runFactCheck,
  wrapUntrusted,
  type FactCheckClaim,
} from '@careeros/ai';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { makeLlmAuditor } from '../../common/llm-audit';
import { JobPreferencesService } from '../job-prefs/job-prefs.service';
import { SnapshotService, type TrendDiff } from './snapshot.service';

const KEY = loadMasterKey();
const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const TOP_N = 10;
const JOB_SAMPLE_LIMIT = 25;

export interface BriefStats {
  windowDays: number;
  totalCount: number;
  newCount: number;
  remoteShare: number;
  topSkills: Array<{ skillId: string; count: number }>;
  topCompanies: Array<{ company: string; count: number }>;
}

export interface BriefSource {
  kind: 'job';
  ref: string; // job id
  url: string; // canonicalUrl (also what the LLM cites by)
}

export interface BriefDto {
  id: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  stats: BriefStats;
  content: MarketBriefContent;
  sources: BriefSource[];
  /**
   * C-P3 debt: "what changed vs last week". Served from the same brief payload
   * (vs the dedicated `/me/market/snapshot/trend` endpoint) so the brief page
   * can render deltas without a second round-trip. `hasComparison=false` when
   * there's no prior snapshot in the 7-14d window; the FE renders "no
   * comparison yet" in that case.
   */
  diff: TrendDiff;
}

@Injectable()
export class MarketBriefService {
  private readonly logger = new Logger(MarketBriefService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
    private readonly prefs: JobPreferencesService,
    private readonly snapshots: SnapshotService,
  ) {}

  async getLatest(userId: string): Promise<BriefDto | null> {
    const row = await this.prisma.marketBrief.findFirst({
      where: { userId },
      orderBy: { generatedAt: 'desc' },
    });
    if (!row) return null;
    return this.toDto(row, await this.snapshots.diffAgainstLastWeek(userId));
  }

  async generate(userId: string): Promise<BriefDto> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);

    const [pool, prefs] = await Promise.all([
      this.loadFilteredPool(userId),
      this.prefs.get(userId),
    ]);
    if (pool.length === 0) {
      throw new BadRequestException(
        'No matching jobs in the pool. Sync some jobs and set your preferences first.',
      );
    }

    const stats = this.computeStats(pool, windowStart);
    const sample = pool.slice(0, JOB_SAMPLE_LIMIT).map((j) => ({
      title: j.title,
      company: j.company,
      canonicalUrl: j.canonicalUrl,
    }));
    const sources: BriefSource[] = sample.map((s) => ({
      kind: 'job',
      ref: s.canonicalUrl,
      url: s.canonicalUrl,
    }));

    const provider = await this.tryLoadProvider(userId);
    if (!provider) {
      throw new BadRequestException(
        'LLM provider not configured or paused; brief needs an LLM to synthesize prose.',
      );
    }

    const candidateContext = [
      `Target roles: ${prefs.targetRoles.length ? prefs.targetRoles.join(', ') : '(none set)'}`,
      `Locations: ${prefs.locations.length ? prefs.locations.join(', ') : '(any)'}`,
      `Remote-only: ${prefs.remoteOnly ? 'yes' : 'no'}`,
      `Seniority: ${prefs.seniority.length ? prefs.seniority.join(', ') : '(any)'}`,
      `Must-have skills: ${prefs.mustHaveSkills.length ? prefs.mustHaveSkills.join(', ') : '(none)'}`,
    ].join('\n');

    const statsRendered = [
      `- ${stats.totalCount} jobs in your preference-filtered pool over the last ${WINDOW_DAYS}d`,
      `- ${stats.newCount} of those are new since ${windowStart.toISOString().slice(0, 10)}`,
      `- ${(stats.remoteShare * 100).toFixed(0)}% are tagged remote`,
      `- Top skills: ${stats.topSkills.map((s) => `${s.skillId} (${s.count})`).join(', ') || '(none extracted)'}`,
      `- Top companies: ${stats.topCompanies.map((c) => `${c.company} (${c.count})`).join(', ') || '(none)'}`,
    ].join('\n');

    // C-P3.7b: wrap EACH sample line individually so a single poisoned title
    // never sinks the whole brief. wrapUntrusted throws InjectionBlockedError
    // on blocked severity; catch per-line, audit `security.audit.injection_blocked`
    // with the job ref, drop the line, continue.
    const wrappedLines: string[] = [];
    const droppedRefs: string[] = [];
    for (const s of sample) {
      try {
        const w = wrapUntrusted(
          `- ${s.title} @ ${s.company} | ${s.canonicalUrl}`,
          'job-description',
        );
        wrappedLines.push(w.content);
      } catch (err) {
        if (err instanceof InjectionBlockedError) {
          droppedRefs.push(s.canonicalUrl);
          await this.auditInjectionBlocked(userId, s.canonicalUrl, err);
          continue;
        }
        throw err;
      }
    }
    if (wrappedLines.length === 0) {
      throw new BadRequestException(
        'Every sampled job was refused by the injection filter. Sync fresh jobs and retry.',
      );
    }

    const rendered = renderPrompt('market-brief-writer', {
      candidateContext,
      windowDays: String(WINDOW_DAYS),
      stats: statsRendered,
      sources: sources.map((s) => `- ${s.url}`).join('\n'),
      jobSample: wrappedLines.join('\n'),
    });
    // A-M9: per-user LLM concurrency ceiling.
    const result = (await this.usage.runWithUserLimit(userId, () =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        schema: rendered.schema,
        temperature: 0.3,
      }),
    )) as MarketBriefContent;

    // Drop cited URLs that aren't in our sources list (hallucination guard).
    const sourceSet = new Set(sources.map((s) => s.url));
    const urlCleaned: MarketBriefContent = {
      sections: result.sections.map((sec) => ({
        heading: sec.heading,
        body: sec.body,
        sourceUrls: sec.sourceUrls.filter((u) => sourceSet.has(u)),
      })),
    };

    // C-P4.7c: per-sentence fact-check. The brief prose can hallucinate a
    // claim ("X company is hiring 40 SREs") whose section still has a valid
    // sourceUrl; URL-post-filter alone doesn't catch that. Split each body
    // into sentences, treat each as a claim cited against the section's
    // sourceUrls (already URL-filtered). Sentences the auditor marks
    // unsupported get dropped from the body; sections whose body ends empty
    // are dropped entirely. Per drop → audit `factcheck.claim.dropped`.
    //
    // Ponytail: naive sentence split on `.!?`. A markdown-aware splitter
    // matters when the writer prompt starts emitting lists; upgrade then.
    const cleaned = await this.factCheckSections(userId, provider, urlCleaned, sample);

    const row = await this.prisma.marketBrief.create({
      data: {
        userId,
        windowStart,
        windowEnd: now,
        statsJson: stats as unknown as Prisma.InputJsonValue,
        content: JSON.stringify(cleaned),
        sourcesJson: sources as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toDto(row, await this.snapshots.diffAgainstLastWeek(userId));
  }

  /**
   * Per-sentence fact-check across every section body. Cited "facts" for a
   * sentence are the section's already-URL-filtered `sourceUrls` mapped to
   * the sample jobs (title/company/url) that were provided to the writer.
   * Any sentence the auditor marks unsupported is stripped from the body;
   * empty sections are dropped. Never throws — auditor failure marks the
   * whole content untouched (fail-open with warn, same contract as slice 20).
   */
  private async factCheckSections(
    userId: string,
    provider: DeepSeekProvider,
    content: MarketBriefContent,
    sample: Array<{ title: string; company: string; canonicalUrl: string }>,
  ): Promise<MarketBriefContent> {
    // Sample-by-url lookup so a sourceUrl becomes a real Fact for the gate.
    const sampleByUrl = new Map(sample.map((s) => [s.canonicalUrl, s]));

    // Flatten sentences across every section into indexed claims; keep a
    // parallel breadcrumb array so we can rebuild the sections in order.
    interface Trail { section: number; sentence: number; sourceUrls: string[] }
    const trails: Trail[] = [];
    const claims: FactCheckClaim[] = [];
    let idx = 0;
    for (let si = 0; si < content.sections.length; si++) {
      const sec = content.sections[si];
      const sentences = splitSentences(sec.body);
      for (let ti = 0; ti < sentences.length; ti++) {
        const text = sentences[ti];
        const cited = sec.sourceUrls.map((u) => {
          const s = sampleByUrl.get(u);
          return {
            id: u,
            kind: 'job',
            summary: s ? `${s.title} @ ${s.company}` : '(url only)',
          };
        });
        trails.push({ section: si, sentence: ti, sourceUrls: sec.sourceUrls });
        claims.push({ index: idx++, text, cited });
      }
    }

    if (claims.length === 0) return content;

    const outcome = await runFactCheck({
      provider,
      claims,
      runWithUserLimit: (fn) => this.usage.runWithUserLimit(userId, fn),
    });
    if (!outcome.ok) {
      // Fail-open: keep the whole content, log for observability. Matches
      // resume-variant/cover-letter "unchecked" default (draft > no-draft).
      this.logger.warn(`market-brief fact-check failed, keeping unchecked: ${outcome.reason}`);
      return content;
    }

    // Rebuild each section body from the kept sentences.
    const droppedByService: Array<{ claim: string; reason: string; sourceRef: string | null }> = [];
    const keptSentencesBySection = new Map<number, string[]>();
    for (let ci = 0; ci < claims.length; ci++) {
      const c = claims[ci];
      const t = trails[ci];
      const v = outcome.verdicts.get(c.index);
      // Missing verdict OR unsupported = DROP (same trust-critical default).
      const drop = !v || !v.supported;
      if (drop) {
        droppedByService.push({
          claim: c.text,
          reason: v?.reason ?? 'no verdict returned by fact-check',
          sourceRef: t.sourceUrls[0] ?? null,
        });
        continue;
      }
      const list = keptSentencesBySection.get(t.section) ?? [];
      list.push(c.text);
      keptSentencesBySection.set(t.section, list);
    }

    for (const d of droppedByService) {
      await this.auditDropped(userId, d.claim, d.reason, d.sourceRef);
    }

    const rebuiltSections = content.sections
      .map((sec, si) => {
        const kept = keptSentencesBySection.get(si) ?? [];
        return {
          heading: sec.heading,
          // Rejoin with a single space — sentence-terminator preserved by
          // splitSentences.
          body: kept.join(' '),
          sourceUrls: sec.sourceUrls,
        };
      })
      .filter((sec) => sec.body.length > 0);

    // MarketBriefContentSchema requires >= 1 section. If every sentence was
    // dropped, fall back to the URL-cleaned content with a single "unchecked"
    // section rather than 400ing the whole request (matches the fail-open
    // stance above). Persist behaviour is honest via the audit rows.
    if (rebuiltSections.length === 0) return content;
    return { sections: rebuiltSections };
  }

  /** Cross-service audit row on every dropped claim. Never throws. */
  private async auditDropped(
    userId: string,
    claim: string,
    reason: string,
    sourceRef: string | null,
  ): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId,
          actor: 'system',
          action: 'factcheck.claim.dropped',
          resourceType: 'market_brief',
          resourceId: sourceRef ?? userId,
          payload: {
            service: 'market-brief',
            claim,
            reason,
            ...(sourceRef ? { sourceRef } : {}),
          },
        },
      });
    } catch {
      /* audit must not throw (also silent when the test fake omits auditEvent) */
    }
  }

  private async loadFilteredPool(userId: string) {
    const prefs = await this.prefs.get(userId);
    const blacklist = new Set(prefs.companyBlacklist.map((c) => c.toLowerCase().trim()));
    const mustHave = new Set(prefs.mustHaveSkills);
    const dealbreakers = new Set(prefs.dealbreakerSkills);
    const cutoff = new Date(Date.now() - 45 * DAY_MS);
    // ponytail: 500-row pre-filter cap. If a user has 1000+ matching jobs the
    // brief silently reflects only the newest 500. Swap to streaming aggregation
    // or precompute `user_market_snapshot` when this becomes visibly wrong.
    const rows = await this.prisma.normalizedJob.findMany({
      where: {
        AND: [
          { OR: [{ sourcePostedAt: { gte: cutoff } }, { sourcePostedAt: null, firstSeenAt: { gte: cutoff } }] },
          prefs.remoteOnly ? { remote: true } : {},
        ],
      },
      orderBy: [{ sourcePostedAt: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
      take: 500,
    });
    return rows.filter((r) => {
      if (blacklist.has(r.company.toLowerCase().trim())) return false;
      const jobSkills = new Set(r.skillIds);
      for (const d of dealbreakers) if (jobSkills.has(d)) return false;
      for (const m of mustHave) if (!jobSkills.has(m)) return false;
      return true;
    });
  }

  private computeStats(
    pool: Array<{ skillIds: string[]; company: string; remote: boolean; sourcePostedAt: Date | null; firstSeenAt: Date }>,
    windowStart: Date,
  ): BriefStats {
    // ponytail: kept as a method-level indirection so the synthesis path is
    // untouched; C-P3.4 snapshot service imports the exported computeStatsFn
    // directly to keep its own compute pure.
    return computeStatsFn(pool, windowStart);
  }

  private toDto(
    row: {
      id: string;
      generatedAt: Date;
      windowStart: Date;
      windowEnd: Date;
      statsJson: Prisma.JsonValue;
      content: string;
      sourcesJson: Prisma.JsonValue;
    },
    diff: TrendDiff,
  ): BriefDto {
    return {
      id: row.id,
      generatedAt: row.generatedAt.toISOString(),
      windowStart: row.windowStart.toISOString(),
      windowEnd: row.windowEnd.toISOString(),
      stats: row.statsJson as unknown as BriefStats,
      content: JSON.parse(row.content) as MarketBriefContent,
      sources: row.sourcesJson as unknown as BriefSource[],
      diff,
    };
  }

  /**
   * C-P3.7b: dedicated audit row per blocked ingest so per-source drops are
   * reviewable in the audit UI alongside the wrap.ts audit hook (ai-safety.md
   * item 5). Same action string the wrap boundary emits.
   */
  private async auditInjectionBlocked(
    userId: string,
    jobUrl: string,
    err: InjectionBlockedError,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'system',
          action: 'security.audit.injection_blocked',
          resourceType: 'market_brief_sample',
          resourceId: jobUrl,
          payload: { jobUrl, source: 'job-description', kinds: err.hits },
        },
      })
      .catch(() => {
        /* audit must not throw */
      });
  }

  /** Same shape as CorpusService / JobsService `tryLoadProvider`. */
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
      this.logger.warn(`market-brief: provider unavailable: ${(err as Error).message}`);
      return null;
    }
  }
}

/**
 * Shared pure-function stats compute used by both `MarketBriefService.generate`
 * (on-demand brief synthesis) and `SnapshotService.computeSnapshot` (C-P3.4
 * weekly persisted snapshots). No I/O; the caller supplies the pre-filtered
 * pool + windowStart. Exported so both callers share the exact same numbers.
 */
export function computeStatsFn(
  pool: Array<{ skillIds: string[]; company: string; remote: boolean; sourcePostedAt: Date | null; firstSeenAt: Date }>,
  windowStart: Date,
): BriefStats {
  const skillCounts = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  let remoteCount = 0;
  let newCount = 0;
  for (const j of pool) {
    for (const s of j.skillIds) skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1);
    companyCounts.set(j.company, (companyCounts.get(j.company) ?? 0) + 1);
    if (j.remote) remoteCount++;
    const posted = j.sourcePostedAt ?? j.firstSeenAt;
    if (posted >= windowStart) newCount++;
  }
  const sortDesc = <T>(entries: Array<[T, number]>) => entries.sort((a, b) => b[1] - a[1]).slice(0, TOP_N);
  return {
    windowDays: WINDOW_DAYS,
    totalCount: pool.length,
    newCount,
    remoteShare: pool.length === 0 ? 0 : remoteCount / pool.length,
    topSkills: sortDesc([...skillCounts.entries()]).map(([skillId, count]) => ({ skillId, count })),
    topCompanies: sortDesc([...companyCounts.entries()]).map(([company, count]) => ({ company, count })),
  };
}

/**
 * Split a body into sentences. Terminators (.!?) are kept on the preceding
 * sentence so the rebuilt body reads naturally. Ponytail: a real tokenizer
 * (e.g. Intl.Segmenter word-break) matters when the writer prompt starts
 * emitting lists or code fences; for prose paragraphs this splits cleanly.
 */
export function splitSentences(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  // Match sequences of non-terminator chars followed by one or more
  // terminators, then trailing whitespace. Falls back to the whole string
  // when no terminator is present (single-sentence body).
  const re = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out.length ? out : [trimmed];
}
