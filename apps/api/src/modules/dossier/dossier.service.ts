import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  InjectionBlockedError,
  UNTRUSTED_SYSTEM_CLAUSE,
  runFactCheck,
  wrapUntrusted,
  type AIProvider,
  type FactCheckClaim,
} from '@careeros/ai';
import { safeFetch, SsrfBlockedError, type AssertPublicUrlOptions } from '@careeros/shared/net';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { ProviderLoaderService } from '../../common/provider-loader.service';

// -----------------------------------------------------------------------------
// Shape contracts stored in the JSON columns. Kept intentionally small so a
// stale row from schema v1 still deserialises when v2 lands new fields.
// -----------------------------------------------------------------------------

export interface DossierIdentity {
  website: string | null;
  linkedinUrl: string | null;
  employeeCount: number | null;
  hq: string | null;
}

export interface EngineeringBlogPost {
  url: string;
  title: string;
  summary: string;
}

export interface DossierTechSignals {
  stackHints: string[];
  engineeringBlogPosts: EngineeringBlogPost[];
}

export interface ReviewAggregate {
  rating: number;
  count: number;
  url: string;
}

export interface RedditReviewThread {
  url: string;
  title: string;
}

export interface DossierReviews {
  ambitionbox?: ReviewAggregate;
  comparably?: ReviewAggregate;
  reddit?: { threads: RedditReviewThread[] };
}

export interface InterviewSignal {
  url: string;
  title: string;
  role: string | null;
}

export interface DossierInterviews {
  leetcodeDiscuss?: InterviewSignal[];
  glassdoorScraped?: InterviewSignal[];
}

export interface RecentEvent {
  kind: 'funding' | 'layoff' | 'launch' | 'acquisition';
  date: string; // ISO
  url: string;
  headline: string;
}

export interface DossierRecentEvents {
  fundingRounds: RecentEvent[];
  layoffs: RecentEvent[];
  productLaunches: RecentEvent[];
  acquisitions: RecentEvent[];
}

export interface DossierDto {
  id: string;
  companyId: string;
  identity: DossierIdentity;
  techSignals: DossierTechSignals;
  reviews: DossierReviews;
  interviews: DossierInterviews;
  recentEvents: DossierRecentEvents;
  synthesis: string;
  factRefs: string[];
  generatedAt: string;
  staleAfter: string;
}

// -----------------------------------------------------------------------------
// Fact + claim: how synthesis is grounded.
// -----------------------------------------------------------------------------

interface Fact {
  id: string;
  content: string;
  sourceUrl: string;
  sourceKind:
    | 'company-page'
    | 'readme'
    | 'job-description'
    | 'comment'
    | 'user-input';
}

const SynthesisSchema = z.object({
  narrative: z.string(),
  claims: z.array(
    z.object({
      text: z.string(),
      factRefs: z.array(z.string()),
    }),
  ),
});

// -----------------------------------------------------------------------------
// Operator-supplied source hints per company. For MVP the operator configures
// URLs upfront (RSS, review pages, news feed). No auto-discovery. If a company
// has no hints, the stage returns the empty shape without a network call.
//
// ponytail: this is an in-code registry, not a DB table. When the operator
// adds more than 3 companies, move to `company_source_hints` DB table.
// -----------------------------------------------------------------------------

export interface CompanySourceHints {
  companyId: string;
  identityUrl?: string; // /about page or similar
  engineeringBlogRss?: string;
  ambitionboxUrl?: string;
  comparablyUrl?: string;
  redditSearchUrl?: string;
  interviewsUrl?: string;
  eventsFeedRss?: string;
  linkedinUrl?: string;
  extraAllowlist?: string[];
  /** Match with User.email or User.id to enable employer-confidential redaction. */
  isCurrentEmployerForUsers?: string[];
}

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30d per plan/phase-4:81
const MAX_BLOG_POSTS = 5;
const MAX_REDDIT_THREADS = 5;
const MAX_EVENTS_PER_KIND = 5;

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

@Injectable()
export class DossierService {
  private readonly logger = new Logger(DossierService.name);
  private readonly hintsByCompany = new Map<string, CompanySourceHints>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
    private readonly providerLoader: ProviderLoaderService,
  ) {}

  /** Test hook + future operator API for feeding per-company source URLs. */
  registerHints(hints: CompanySourceHints): void {
    this.hintsByCompany.set(hints.companyId, hints);
  }

  async getCached(companyId: string): Promise<DossierDto | null> {
    const row = await this.prisma.companyDossier.findUnique({ where: { companyId } });
    return row ? this.toDto(row) : null;
  }

  async requireCached(companyId: string): Promise<DossierDto> {
    const dto = await this.getCached(companyId);
    if (!dto) {
      throw new NotFoundException(`No dossier for company ${companyId}`);
    }
    return dto;
  }

  /**
   * Assemble (or return cached) dossier. Six-stage pipeline; each stage
   * catches its own errors and audits `dossier.stage.failed` so one bad
   * fetch never nukes the whole assembly.
   */
  async assembleFor(userId: string, companyId: string): Promise<DossierDto> {
    const existing = await this.prisma.companyDossier.findUnique({ where: { companyId } });
    if (existing && existing.staleAfter.getTime() > Date.now()) {
      return this.toDto(existing);
    }

    const hints = this.hintsByCompany.get(companyId) ?? { companyId };
    const fetchOpts: AssertPublicUrlOptions = hints.extraAllowlist
      ? { allowlist: hints.extraAllowlist }
      : {};

    const identity = await this.stage('identity', companyId, () =>
      this.identity(companyId, hints, fetchOpts),
    ) ?? { website: null, linkedinUrl: hints.linkedinUrl ?? null, employeeCount: null, hq: null };

    const techSignals = await this.stage('techSignals', companyId, () =>
      this.techSignals(hints, fetchOpts, userId),
    ) ?? { stackHints: [], engineeringBlogPosts: [] };

    const reviews = await this.stage('reviews', companyId, () =>
      this.reviews(hints, fetchOpts),
    ) ?? {};

    const interviews = await this.stage('interviews', companyId, () =>
      this.interviews(hints, fetchOpts),
    ) ?? {};

    const recentEvents = await this.stage('recentEvents', companyId, () =>
      this.recentEvents(hints, fetchOpts),
    ) ?? { fundingRounds: [], layoffs: [], productLaunches: [], acquisitions: [] };

    const isEmployerConfidential = await this.isEmployerConfidential(userId, hints);
    const synth = await this.synthesize({
      companyId,
      identity,
      techSignals,
      reviews,
      interviews,
      recentEvents,
      userId,
      redactSensitive: isEmployerConfidential,
    });

    const now = new Date();
    const staleAfter = new Date(now.getTime() + STALE_MS);
    const row = await this.prisma.companyDossier.upsert({
      where: { companyId },
      create: {
        companyId,
        identity: identity as unknown as Prisma.InputJsonValue,
        techSignals: techSignals as unknown as Prisma.InputJsonValue,
        reviews: reviews as unknown as Prisma.InputJsonValue,
        interviews: interviews as unknown as Prisma.InputJsonValue,
        recentEvents: recentEvents as unknown as Prisma.InputJsonValue,
        synthesis: synth.narrative,
        factRefs: synth.factRefs,
        generatedAt: now,
        staleAfter,
      },
      update: {
        identity: identity as unknown as Prisma.InputJsonValue,
        techSignals: techSignals as unknown as Prisma.InputJsonValue,
        reviews: reviews as unknown as Prisma.InputJsonValue,
        interviews: interviews as unknown as Prisma.InputJsonValue,
        recentEvents: recentEvents as unknown as Prisma.InputJsonValue,
        synthesis: synth.narrative,
        factRefs: synth.factRefs,
        generatedAt: now,
        staleAfter,
      },
    });

    await this.audit(userId, 'dossier.synthesized', companyId, {
      claimsKept: synth.claimsKept,
      claimsDropped: synth.claimsDropped,
      factRefs: synth.factRefs.length,
      redactedForEmployer: isEmployerConfidential,
    });

    return this.toDto(row);
  }

  // ---------------------------------------------------------------------------
  // Stage 1: identity
  // ---------------------------------------------------------------------------
  private async identity(
    companyId: string,
    hints: CompanySourceHints,
    fetchOpts: AssertPublicUrlOptions,
  ): Promise<DossierIdentity> {
    let website: string | null = null;
    if (hints.identityUrl) {
      // safeFetch validates the URL first; SsrfBlockedError is re-thrown so the
      // stage wrapper audits `dossier.stage.failed` with the SSRF detail.
      const res = await safeFetch(hints.identityUrl, {}, fetchOpts);
      if (res.ok) website = hints.identityUrl;
    }
    return {
      website,
      linkedinUrl: hints.linkedinUrl ?? null,
      employeeCount: null,
      hq: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Stage 2: tech signals via engineering blog RSS
  // ---------------------------------------------------------------------------
  private async techSignals(
    hints: CompanySourceHints,
    fetchOpts: AssertPublicUrlOptions,
    userId: string,
  ): Promise<DossierTechSignals> {
    if (!hints.engineeringBlogRss) return { stackHints: [], engineeringBlogPosts: [] };
    const res = await safeFetch(hints.engineeringBlogRss, {}, fetchOpts);
    if (!res.ok) return { stackHints: [], engineeringBlogPosts: [] };
    const body = await res.text();
    const posts = parseRssPosts(body).slice(0, MAX_BLOG_POSTS);

    // Wrap each post BEFORE any LLM sees it. Injection-blocked posts throw
    // InjectionBlockedError; caught in the stage wrapper and audited as
    // `dossier.injection_blocked` via the wrap audit hook path plus the stage
    // failure record. We fold blocked posts by continuing without them.
    const wrapped: EngineeringBlogPost[] = [];
    for (const p of posts) {
      try {
        wrapUntrusted(`${p.title}\n${p.summary}`, 'company-page', { userId });
        wrapped.push(p);
      } catch (err) {
        if (err instanceof InjectionBlockedError) {
          await this.audit(userId, 'dossier.injection_blocked', hints.companyId, {
            stage: 'techSignals',
            url: p.url,
          });
          continue;
        }
        throw err;
      }
    }

    // ponytail: naive stack-hint extraction via keyword grep over titles + summaries.
    // Upgrade to LLM `chatStructured` with a Zod-schema stack extractor when the
    // hint list needs to include versions or novel tech (a keyword grep can't see
    // "we moved from Kafka to Pulsar last quarter"). Keeps the pipeline running
    // when no provider is configured, and keeps tests provider-free.
    const stackHints = extractStackHints(wrapped);
    return { stackHints, engineeringBlogPosts: wrapped };
  }

  // ---------------------------------------------------------------------------
  // Stage 3: reviews aggregate (AmbitionBox + Comparably + Reddit)
  // ---------------------------------------------------------------------------
  private async reviews(
    hints: CompanySourceHints,
    fetchOpts: AssertPublicUrlOptions,
  ): Promise<DossierReviews> {
    const out: DossierReviews = {};
    if (hints.ambitionboxUrl) {
      const agg = await this.fetchReviewAggregate(hints.ambitionboxUrl, fetchOpts);
      if (agg) out.ambitionbox = agg;
    }
    if (hints.comparablyUrl) {
      const agg = await this.fetchReviewAggregate(hints.comparablyUrl, fetchOpts);
      if (agg) out.comparably = agg;
    }
    if (hints.redditSearchUrl) {
      const threads = await this.fetchRedditThreads(hints.redditSearchUrl, fetchOpts);
      if (threads.length) out.reddit = { threads };
    }
    return out;
  }

  private async fetchReviewAggregate(
    url: string,
    fetchOpts: AssertPublicUrlOptions,
  ): Promise<ReviewAggregate | null> {
    const res = await safeFetch(url, {}, fetchOpts);
    if (!res.ok) return null;
    const body = await res.text();
    // Store aggregate shape only. No review body text (copyright).
    // ponytail: regex over the page's meta tags; site-specific selectors land
    // in per-adapter modules when we add a second review source.
    const rating = matchNumber(body, /"aggregateRating"\s*:\s*\{[^}]*"ratingValue"\s*:\s*"?([\d.]+)/);
    const count = matchNumber(body, /"aggregateRating"\s*:\s*\{[^}]*"ratingCount"\s*:\s*"?(\d+)/);
    if (rating === null || count === null) return null;
    return { rating, count, url };
  }

  private async fetchRedditThreads(
    url: string,
    fetchOpts: AssertPublicUrlOptions,
  ): Promise<RedditReviewThread[]> {
    const res = await safeFetch(url, { headers: { accept: 'application/json' } }, fetchOpts);
    if (!res.ok) return [];
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return [];
    }
    const threads: RedditReviewThread[] = [];
    // Reddit search JSON: { data: { children: [{ data: { title, permalink } }] } }
    const children = (data as { data?: { children?: Array<{ data?: { title?: string; permalink?: string } }> } })
      ?.data?.children ?? [];
    for (const c of children.slice(0, MAX_REDDIT_THREADS)) {
      const title = c?.data?.title;
      const perma = c?.data?.permalink;
      if (typeof title === 'string' && typeof perma === 'string') {
        threads.push({ url: `https://reddit.com${perma}`, title });
      }
    }
    return threads;
  }

  // ---------------------------------------------------------------------------
  // Stage 4: interview signals
  // ---------------------------------------------------------------------------
  private async interviews(
    hints: CompanySourceHints,
    fetchOpts: AssertPublicUrlOptions,
  ): Promise<DossierInterviews> {
    if (!hints.interviewsUrl) return {};
    const res = await safeFetch(hints.interviewsUrl, { headers: { accept: 'application/json' } }, fetchOpts);
    if (!res.ok) return {};
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return {};
    }
    const rows = (data as { items?: Array<{ url?: string; title?: string; role?: string | null }> })?.items ?? [];
    const signals: InterviewSignal[] = [];
    for (const r of rows.slice(0, 10)) {
      if (typeof r.url === 'string' && typeof r.title === 'string') {
        signals.push({ url: r.url, title: r.title, role: r.role ?? null });
      }
    }
    return signals.length ? { leetcodeDiscuss: signals } : {};
  }

  // ---------------------------------------------------------------------------
  // Stage 5: recent events RSS
  // ---------------------------------------------------------------------------
  private async recentEvents(
    hints: CompanySourceHints,
    fetchOpts: AssertPublicUrlOptions,
  ): Promise<DossierRecentEvents> {
    const empty: DossierRecentEvents = {
      fundingRounds: [],
      layoffs: [],
      productLaunches: [],
      acquisitions: [],
    };
    if (!hints.eventsFeedRss) return empty;
    const res = await safeFetch(hints.eventsFeedRss, {}, fetchOpts);
    if (!res.ok) return empty;
    const body = await res.text();
    const items = parseRssPosts(body);
    const out: DossierRecentEvents = { ...empty };
    for (const item of items) {
      const kind = classifyEvent(item.title);
      if (!kind) continue;
      const bucket = out[eventBucket(kind)];
      if (bucket.length >= MAX_EVENTS_PER_KIND) continue;
      bucket.push({ kind, date: new Date().toISOString(), url: item.url, headline: item.title });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Stage 6: synthesis (grounded generation)
  // ---------------------------------------------------------------------------
  private async synthesize(input: {
    companyId: string;
    identity: DossierIdentity;
    techSignals: DossierTechSignals;
    reviews: DossierReviews;
    interviews: DossierInterviews;
    recentEvents: DossierRecentEvents;
    userId: string;
    redactSensitive: boolean;
  }): Promise<{ narrative: string; factRefs: string[]; claimsKept: number; claimsDropped: number }> {
    const facts = buildFacts(input);
    const provider = await this.tryLoadProvider(input.userId);
    if (!provider) {
      // No LLM: emit a plain-facts narrative so the dossier is still useful.
      // Every fact id is retained as a factRef so the UI can render source chips.
      const narrative = facts
        .map((f) => `- ${f.content} (source: ${f.sourceUrl})`)
        .join('\n');
      return {
        narrative,
        factRefs: facts.map((f) => f.id),
        claimsKept: facts.length,
        claimsDropped: 0,
      };
    }

    // Wrap every fact for the LLM. wrapUntrusted throws on `blocked` severity;
    // any single blocked fact should not sink the whole synthesis, so drop it
    // and continue with the rest.
    const wrappedFacts: Array<{ id: string; wrapped: string }> = [];
    for (const f of facts) {
      try {
        const w = wrapUntrusted(`[id=${f.id}] ${f.content}`, f.sourceKind, {
          userId: input.userId,
        });
        wrappedFacts.push({ id: f.id, wrapped: w.content });
      } catch (err) {
        if (err instanceof InjectionBlockedError) {
          await this.audit(input.userId, 'dossier.injection_blocked', input.companyId, {
            stage: 'synthesize',
            factId: f.id,
          });
          continue;
        }
        throw err;
      }
    }

    const knownFactIds = new Set(wrappedFacts.map((w) => w.id));
    const factsBlock = wrappedFacts.map((w) => w.wrapped).join('\n\n');

    const systemLines = [
      UNTRUSTED_SYSTEM_CLAUSE,
      'You are a company-dossier synthesiser. Produce a short factual narrative that ONLY uses claims backed by one or more <untrusted> facts below.',
      'For every claim you emit, list the [id=...] of every fact that supports it in the `factRefs` array. If a sentence cannot be backed by a listed id, DO NOT emit it.',
    ];
    if (input.redactSensitive) {
      systemLines.push(
        'Employer-confidential redaction: DO NOT mention any technology stack, engineering blog post, or employee review in the narrative. Restrict yourself to public identity and recent public events only.',
      );
    }

    const result = (await this.usage.runWithUserLimit(input.userId, () =>
      provider.chatStructured({
        messages: [
          { role: 'system', content: systemLines.join('\n') },
          {
            role: 'user',
            content: `Company: ${input.companyId}\n\nFacts:\n${factsBlock}`,
          },
        ],
        schema: SynthesisSchema,
        temperature: 0,
        meta: { sensitivity: input.redactSensitive ? 'public' : 'personal' },
      }),
    )) as z.infer<typeof SynthesisSchema>;

    // Grounded-generation contract: drop any claim whose factRefs are empty or
    // reference an id we did not put in the prompt.
    interface GroundedClaim { text: string; cleanRefs: string[] }
    const grounded: GroundedClaim[] = [];
    let dropped = 0;
    for (const c of result.claims) {
      const cleanRefs = c.factRefs.filter((r) => knownFactIds.has(r));
      if (cleanRefs.length === 0) {
        dropped++;
        continue;
      }
      grounded.push({ text: c.text, cleanRefs });
    }

    // C-P4.7d: second-pass per-claim fact-check. Grounded-generation ensures
    // the claim CITES a real fact; this pass checks the claim TEXT is actually
    // supported by that cited fact's content (matches the resume-variants
    // slice-20 gate). Missing verdict OR unsupported = DROP; auditor throw
    // = fail-open (keep grounded set, no additional drops).
    const factById = new Map(facts.map((f) => [f.id, f]));
    const claims: FactCheckClaim[] = grounded.map((g, i) => ({
      index: i,
      text: g.text,
      cited: g.cleanRefs.map((id) => {
        const f = factById.get(id);
        return f
          ? { id: f.id, kind: f.sourceKind, summary: f.content }
          : { id, kind: 'missing', summary: '(MISSING)' };
      }),
    }));

    const outcome = await runFactCheck({
      provider,
      claims,
      runWithUserLimit: (fn) => this.usage.runWithUserLimit(input.userId, fn),
    });

    const kept: string[] = [];
    const usedRefs = new Set<string>();
    let factCheckDropped = 0;
    for (let i = 0; i < grounded.length; i++) {
      const g = grounded[i];
      if (outcome.ok) {
        const v = outcome.verdicts.get(i);
        if (!v || !v.supported) {
          factCheckDropped++;
          const reason = v?.reason ?? 'no verdict returned by fact-check';
          await this.auditDropped(input.userId, input.companyId, g.text, reason, g.cleanRefs[0] ?? null);
          continue;
        }
      } else if (i === 0) {
        // Auditor threw. Log once (i===0 gate keeps the warn count sane in a
        // loop) and fall through to keep the grounded set — same "unchecked"
        // fail-open contract slice 20 uses. No factcheck.claim.dropped rows.
        this.logger.warn(`dossier fact-check failed, keeping unchecked: ${outcome.reason}`);
      }
      kept.push(g.text);
      for (const r of g.cleanRefs) usedRefs.add(r);
    }

    return {
      narrative: kept.length ? kept.join('\n') : '(no grounded claims produced)',
      factRefs: [...usedRefs],
      claimsKept: kept.length,
      claimsDropped: dropped + factCheckDropped,
    };
  }

  /** Cross-service audit row on every dropped claim. Never throws. */
  private async auditDropped(
    userId: string,
    companyId: string,
    claim: string,
    reason: string,
    sourceRef: string | null,
  ): Promise<void> {
    await this.audit(userId, 'factcheck.claim.dropped', companyId, {
      service: 'dossier',
      claim,
      reason,
      ...(sourceRef ? { sourceRef } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Sensitivity gate
  // ---------------------------------------------------------------------------
  private async isEmployerConfidential(
    userId: string,
    hints: CompanySourceHints,
  ): Promise<boolean> {
    // TODO(C-P0.3): the sensitivity-gate + `User.currentEmployerCompanyId` flag
    // is owned by C-P0.3. Until it lands, we honour an in-code list per hint
    // (`isCurrentEmployerForUsers`) so the redaction path is testable + wired.
    // When C-P0.3 ships, replace this with a User-record lookup and a
    // SensitivityGateService.assertAllowed('employer-confidential', ...) call.
    return hints.isCurrentEmployerForUsers?.includes(userId) ?? false;
  }

  // ---------------------------------------------------------------------------
  // Stage-runner: single audit-logged catch site so each stage failure is
  // recorded exactly once, and the pipeline continues with a safe null.
  // ---------------------------------------------------------------------------
  private async stage<T>(
    stageName: string,
    companyId: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      const code =
        err instanceof SsrfBlockedError
          ? 'dossier.ssrf_rejected'
          : err instanceof InjectionBlockedError
          ? 'dossier.injection_blocked'
          : 'dossier.stage.failed';
      await this.audit(null, code, companyId, {
        stage: stageName,
        message: (err as Error).message,
      });
      this.logger.warn(`dossier stage ${stageName} failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async audit(
    userId: string | null,
    action: string,
    companyId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: userId ? 'user' : 'system',
          action,
          resourceType: 'company_dossier',
          resourceId: companyId,
          payload: payload as Prisma.InputJsonValue,
        },
      })
      .catch(() => {
        /* audit must not throw */
      });
  }

  private async tryLoadProvider(userId: string): Promise<AIProvider | null> {
    try {
      const loaded = await this.providerLoader.loadProviderForUser(userId, 'public');
      return loaded?.provider ?? null;
    } catch (err) {
      this.logger.warn(`dossier: provider unavailable: ${(err as Error).message}`);
      return null;
    }
  }

  private toDto(row: {
    id: string;
    companyId: string;
    identity: Prisma.JsonValue;
    techSignals: Prisma.JsonValue;
    reviews: Prisma.JsonValue;
    interviews: Prisma.JsonValue;
    recentEvents: Prisma.JsonValue;
    synthesis: string;
    factRefs: string[];
    generatedAt: Date;
    staleAfter: Date;
  }): DossierDto {
    return {
      id: row.id,
      companyId: row.companyId,
      identity: row.identity as unknown as DossierIdentity,
      techSignals: row.techSignals as unknown as DossierTechSignals,
      reviews: row.reviews as unknown as DossierReviews,
      interviews: row.interviews as unknown as DossierInterviews,
      recentEvents: row.recentEvents as unknown as DossierRecentEvents,
      synthesis: row.synthesis,
      factRefs: row.factRefs,
      generatedAt: row.generatedAt.toISOString(),
      staleAfter: row.staleAfter.toISOString(),
    };
  }
}

// -----------------------------------------------------------------------------
// Helpers (module-private, pure)
// -----------------------------------------------------------------------------

/** Extract <item> blocks (RSS 2.0) or <entry> blocks (Atom). Small + tolerant. */
export function parseRssPosts(xml: string): EngineeringBlogPost[] {
  const posts: EngineeringBlogPost[] = [];
  const itemRe = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const inner = m[2];
    const title = firstMatch(inner, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const link =
      firstMatch(inner, /<link[^>]*>([^<]+)<\/link>/i) ??
      firstMatch(inner, /<link[^>]*href="([^"]+)"/i);
    const summary =
      firstMatch(inner, /<description[^>]*>([\s\S]*?)<\/description>/i) ??
      firstMatch(inner, /<summary[^>]*>([\s\S]*?)<\/summary>/i) ??
      '';
    if (title && link) {
      posts.push({
        url: link.trim(),
        title: decodeCdata(title).trim(),
        summary: decodeCdata(summary).trim().slice(0, 500),
      });
    }
  }
  return posts;
}

function firstMatch(s: string, re: RegExp): string | null {
  const m = re.exec(s);
  return m ? m[1] : null;
}

function decodeCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[|\]\]>$/g, '');
}

const STACK_KEYWORDS = [
  'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'swift',
  'react', 'nextjs', 'vue', 'svelte', 'angular',
  'postgres', 'mysql', 'mongodb', 'redis', 'kafka', 'pulsar', 'clickhouse',
  'kubernetes', 'docker', 'terraform', 'aws', 'gcp', 'azure',
  'graphql', 'grpc', 'rest',
];

export function extractStackHints(posts: EngineeringBlogPost[]): string[] {
  const found = new Set<string>();
  const hay = posts.map((p) => `${p.title} ${p.summary}`).join(' ').toLowerCase();
  for (const kw of STACK_KEYWORDS) {
    if (hay.includes(kw)) found.add(kw);
  }
  return [...found].sort();
}

function matchNumber(body: string, re: RegExp): number | null {
  const m = re.exec(body);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function classifyEvent(headline: string): RecentEvent['kind'] | null {
  const h = headline.toLowerCase();
  if (/(series [a-z]|raises|funding|round)/i.test(h)) return 'funding';
  if (/(layoff|lay off|layoffs|reduce.* workforce)/i.test(h)) return 'layoff';
  if (/(launches|announces|introduces|ships|releases)/i.test(h)) return 'launch';
  if (/(acquires|acquisition|acquired)/i.test(h)) return 'acquisition';
  return null;
}

function eventBucket(k: RecentEvent['kind']): keyof DossierRecentEvents {
  switch (k) {
    case 'funding': return 'fundingRounds';
    case 'layoff': return 'layoffs';
    case 'launch': return 'productLaunches';
    case 'acquisition': return 'acquisitions';
  }
}

function buildFacts(input: {
  companyId: string;
  identity: DossierIdentity;
  techSignals: DossierTechSignals;
  reviews: DossierReviews;
  interviews: DossierInterviews;
  recentEvents: DossierRecentEvents;
}): Fact[] {
  const facts: Fact[] = [];
  let idx = 0;
  const push = (content: string, sourceUrl: string, sourceKind: Fact['sourceKind']) => {
    facts.push({ id: `fact-${++idx}`, content, sourceUrl, sourceKind });
  };
  if (input.identity.website) {
    push(`Website: ${input.identity.website}`, input.identity.website, 'company-page');
  }
  if (input.identity.linkedinUrl) {
    push(`LinkedIn: ${input.identity.linkedinUrl}`, input.identity.linkedinUrl, 'company-page');
  }
  for (const post of input.techSignals.engineeringBlogPosts) {
    push(`Engineering post: ${post.title}. ${post.summary}`, post.url, 'company-page');
  }
  if (input.techSignals.stackHints.length) {
    push(
      `Stack keywords across engineering posts: ${input.techSignals.stackHints.join(', ')}`,
      'internal://stack-hints',
      'user-input',
    );
  }
  if (input.reviews.ambitionbox) {
    push(
      `AmbitionBox rating ${input.reviews.ambitionbox.rating} across ${input.reviews.ambitionbox.count} reviews.`,
      input.reviews.ambitionbox.url,
      'company-page',
    );
  }
  if (input.reviews.comparably) {
    push(
      `Comparably rating ${input.reviews.comparably.rating} across ${input.reviews.comparably.count} reviews.`,
      input.reviews.comparably.url,
      'company-page',
    );
  }
  for (const t of input.reviews.reddit?.threads ?? []) {
    push(`Reddit thread: ${t.title}`, t.url, 'comment');
  }
  for (const s of input.interviews.leetcodeDiscuss ?? []) {
    push(`Interview signal: ${s.title}`, s.url, 'comment');
  }
  for (const kind of ['fundingRounds', 'layoffs', 'productLaunches', 'acquisitions'] as const) {
    for (const e of input.recentEvents[kind]) {
      push(`${e.kind}: ${e.headline}`, e.url, 'company-page');
    }
  }
  return facts;
}
