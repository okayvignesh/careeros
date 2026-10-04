import { z } from 'zod';
import { assertPublicUrlShape, SsrfBlockedError } from '../net/shape';

// Sync gate reused by every user-supplied baseUrl. Returns true if the URL is
// well-formed, on the allowlist, and not a literal private IP. DNS-resolution
// SSRF checks still run in the fetch path (assertPublicUrl).
function isPublicUrlShape(v: string): boolean {
  try {
    assertPublicUrlShape(v);
    return true;
  } catch (err) {
    return !(err instanceof SsrfBlockedError) ? false : false;
  }
}

const PublicUrlSchema = z.string().url().refine(isPublicUrlShape, {
  message: 'URL host is not on the SSRF allowlist or resolves to a private address',
});

export const EmailSchema = z.string().email().max(320);
export const PasswordSchema = z.string().min(12).max(200);

export const CreateAccountSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: z.string().min(1).max(100).optional(),
});
export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;

export const ProviderConfigSchema = z.object({
  provider: z.enum(['deepseek', 'openai', 'anthropic', 'ollama', 'azure', 'openrouter', 'custom']),
  apiKey: z.string().min(1).max(500),
  baseUrl: PublicUrlSchema.optional(),
  chatModel: z.string().min(1).max(120),
  reasoningModel: z.string().min(1).max(120).optional(),
});
export type ProviderConfigInput = z.infer<typeof ProviderConfigSchema>;

export const EmbeddingModeSchema = z.enum(['local', 'deterministic', 'external']);
export type EmbeddingMode = z.infer<typeof EmbeddingModeSchema>;

export const EmbeddingConfigSchema = z.object({
  mode: EmbeddingModeSchema,
  model: z.string().min(1).max(120).default('Xenova/bge-small-en-v1.5'),
  externalBaseUrl: PublicUrlSchema.optional(),
  externalApiKey: z.string().min(1).max(500).optional(),
  /** Expected vector dimension for external mode. Required by the API when mode=external. */
  dimensions: z.number().int().positive().max(8192).optional(),
});
export type EmbeddingConfigInput = z.infer<typeof EmbeddingConfigSchema>;

export const GithubConnectSchema = z.object({
  token: z.string().min(20).max(500),
});
export type GithubConnectInput = z.infer<typeof GithubConnectSchema>;

export const IntegrationSummarySchema = z.object({
  kind: z.enum(['github', 'slack', 'gmail']),
  status: z.enum(['connected', 'revoked']),
  connectedAt: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type IntegrationSummary = z.infer<typeof IntegrationSummarySchema>;

export const CareerGoalsSchema = z.object({
  targetRoles: z.array(z.string().min(1).max(120)).min(1).max(10),
  locations: z.array(z.string().min(1).max(120)).min(1).max(20),
  remoteOnly: z.boolean(),
  compMin: z.number().int().nonnegative().optional(),
  compMax: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).default('USD'),
  seniority: z
    .array(z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager']))
    .min(1),
  timezone: z.string().min(1).max(80),
});
export type CareerGoalsInput = z.infer<typeof CareerGoalsSchema>;

export const SignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
});
export type SignInInput = z.infer<typeof SignInSchema>;

export const CapabilityResultSchema = z.object({
  chat: z.object({ ok: z.boolean(), latencyMs: z.number(), error: z.string().optional() }),
  structured: z.object({ ok: z.boolean(), latencyMs: z.number(), error: z.string().optional() }),
  tools: z.object({ ok: z.boolean(), latencyMs: z.number(), error: z.string().optional() }),
  streaming: z.object({ ok: z.boolean(), latencyMs: z.number(), error: z.string().optional() }),
});
export type CapabilityResult = z.infer<typeof CapabilityResultSchema>;

export const EmploymentFactSchema = z.object({
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  start: z.string().max(40).nullable(),
  end: z.string().max(40).nullable(),
  bullets: z.array(z.string().min(1).max(500)).default([]),
});

export const EducationFactSchema = z.object({
  school: z.string().min(1).max(200),
  degree: z.string().min(1).max(200),
  field: z.string().max(200).nullable(),
  year: z.string().max(40).nullable(),
});

export const SkillFactSchema = z.object({
  name: z.string().min(1).max(120),
  evidence: z.string().max(400).nullable(),
});

export const ProjectFactSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(600),
});

export const ExtractedFactsSchema = z.object({
  headline: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  employment: z.array(EmploymentFactSchema).default([]),
  education: z.array(EducationFactSchema).default([]),
  skills: z.array(SkillFactSchema).default([]),
  projects: z.array(ProjectFactSchema).default([]),
});
export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;

export const ResumeConfirmSchema = z.object({
  facts: ExtractedFactsSchema,
});
export type ResumeConfirmInput = z.infer<typeof ResumeConfirmSchema>;

export const KnowledgeGradeSchema = z.object({
  score: z.number().min(0).max(1),
  hits: z.array(z.string()).default([]),
  misses: z.array(z.string()).default([]),
  reasoning: z.string().min(1).max(1000),
});
export type KnowledgeGrade = z.infer<typeof KnowledgeGradeSchema>;

// LLM-generated knowledge question. `keyPoints` must be concise (each a phrase
// the grader can look for). 2..6 points keeps grading stable; too few produces
// low-signal scores, too many produces false-negative misses.
export const GeneratedQuestionSchema = z.object({
  prompt: z.string().min(40).max(800),
  keyPoints: z.array(z.string().min(2).max(80)).min(2).max(6),
  answerHint: z.string().min(1).max(200).nullable(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

// LLM-generated system-design task. `scenario` describes what to design;
// `constraints` list the non-negotiables (RPS, latency budgets, storage class).
export const GeneratedSystemDesignSchema = z.object({
  scenario: z.string().min(40).max(1200),
  constraints: z.array(z.string().min(4).max(200)).min(1).max(8),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});
export type GeneratedSystemDesign = z.infer<typeof GeneratedSystemDesignSchema>;

// Grader returns a per-dimension score (1..5) with cited evidence + an overall
// score in [0..1] (mean/5). `dimensions[]` covers exactly the rubric's dims.
export const RubricDimensionScoreSchema = z.object({
  dimensionId: z.string().min(1).max(40),
  score: z.number().int().min(1).max(5),
  notes: z.string().min(1).max(400),
});
export const RubricGradeSchema = z.object({
  score: z.number().min(0).max(1),
  dimensions: z.array(RubricDimensionScoreSchema).min(1).max(10),
  reasoning: z.string().min(1).max(1000),
});
export type RubricGradeResponse = z.infer<typeof RubricGradeSchema>;

// Per-user job-search preferences. Every field is optional — empty means
// "no filter on this axis". Skill ID arrays reference the ESCO-lite catalogue.
export const JobPreferencesInputSchema = z.object({
  targetRoles: z.array(z.string().min(1).max(120)).max(20).default([]),
  locations: z.array(z.string().min(1).max(120)).max(20).default([]),
  remoteOnly: z.boolean().default(false),
  compMin: z.number().int().nonnegative().nullable().optional(),
  compMax: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().length(3).default('USD'),
  seniority: z
    .array(z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager']))
    .default([]),
  mustHaveSkills: z.array(z.string().min(1).max(60)).max(20).default([]),
  dealbreakerSkills: z.array(z.string().min(1).max(60)).max(20).default([]),
  companyBlacklist: z.array(z.string().min(1).max(200)).max(100).default([]),
});
export type JobPreferencesInput = z.infer<typeof JobPreferencesInputSchema>;

// Cover letter content. Sibling of TailoredResumeContent: greeting + paragraphs
// + closing, each paragraph carrying `factRefs` for grounded audit. Same
// fact-check pattern applies (unsupported paragraphs dropped pre-persist).
export const CoverLetterParagraphSchema = z.object({
  text: z.string().min(10).max(1200),
  factRefs: z.array(z.string()).max(6),
});
export const CoverLetterContentSchema = z.object({
  greeting: z.string().min(3).max(200),
  paragraphs: z.array(CoverLetterParagraphSchema).min(2).max(6),
  closing: z.string().min(3).max(200),
});
export type CoverLetterContent = z.infer<typeof CoverLetterContentSchema>;

// Per-bullet fact-check verdict. `bulletIndex` is a monotonic index across
// all bullets in the variant (flat, section-agnostic; easier to correlate).
// `supported=false` means the bullet's text claims more than its cited facts
// justify; the service drops it before persist.
export const FactCheckResultSchema = z.object({
  results: z
    .array(
      z.object({
        bulletIndex: z.number().int().nonnegative(),
        supported: z.boolean(),
        reason: z.string().min(1).max(400),
      }),
    )
    .max(80),
});
export type FactCheckResult = z.infer<typeof FactCheckResultSchema>;

// Tailored resume content. Structured shape rendered to markdown/PDF/DOCX by
// downstream slices. Every bullet carries `factRefs[]` pointing at the
// `ResumeFact.id` rows the LLM used, so generation is auditable and un-cited
// bullets can be flagged before shipping.
export const TailoredResumeBulletSchema = z.object({
  text: z.string().min(4).max(400),
  factRefs: z.array(z.string()).max(6),
});
export const TailoredResumeSectionSchema = z.object({
  heading: z.string().min(1).max(120),
  bullets: z.array(TailoredResumeBulletSchema).min(1).max(10),
});
export const TailoredResumeContentSchema = z.object({
  summary: z.string().min(10).max(600),
  sections: z.array(TailoredResumeSectionSchema).min(1).max(8),
});
export type TailoredResumeContent = z.infer<typeof TailoredResumeContentSchema>;

// Market brief content — LLM synthesizes weekly market signals from stats.
// Every section body may reference source URLs from the supplied list; the
// service post-validates that cited URLs appear in the sources array.
export const MarketBriefSectionSchema = z.object({
  heading: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  sourceUrls: z.array(z.string().url()).max(20).default([]),
});
export const MarketBriefContentSchema = z.object({
  sections: z.array(MarketBriefSectionSchema).min(1).max(6),
});
export type MarketBriefContent = z.infer<typeof MarketBriefContentSchema>;

// Job skill extraction — LLM picks skill IDs from a candidate list. The
// prompt renders the seed catalogue inline, and the schema keeps the response
// tight (empty allowed for no-match; upper bound 20 keeps token cost bounded).
export const JobSkillExtractionSchema = z.object({
  skillIds: z.array(z.string().min(1).max(60)).max(20),
});
export type JobSkillExtraction = z.infer<typeof JobSkillExtractionSchema>;

// LLM key-points extractor. Given a raw question (from an external corpus),
// return the 2-6 short phrases the grader will look for. Used at ingest time
// so corpus questions can be graded by the existing keyPoints-based grader.
export const KeyPointsExtractionSchema = z.object({
  keyPoints: z.array(z.string().min(2).max(80)).min(2).max(6),
});
export type KeyPointsExtraction = z.infer<typeof KeyPointsExtractionSchema>;

// LLM-generated code-review task. `diff` is a small unified-diff snippet with
// 2..4 intentional defects; `defects[]` is the hidden answer key — a short
// natural-language description of each defect the reviewer should catch.
export const GeneratedCodeReviewSchema = z.object({
  language: z.string().min(1).max(40),
  scenario: z.string().min(20).max(400),
  diff: z.string().min(40).max(3000),
  defects: z.array(z.string().min(6).max(200)).min(2).max(4),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});
export type GeneratedCodeReview = z.infer<typeof GeneratedCodeReviewSchema>;

// LLM-generated debugging task. Small broken snippet with a hidden root cause.
// `description` tells the candidate what the function is supposed to do;
// `rootCause` + `hint` are the answer key (never shown to the candidate).
export const GeneratedDebuggingTaskSchema = z.object({
  language: z.string().min(1).max(40),
  description: z.string().min(20).max(400),
  brokenCode: z.string().min(20).max(2000),
  rootCause: z.string().min(10).max(400),
  hint: z.string().min(4).max(200),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});
export type GeneratedDebuggingTask = z.infer<typeof GeneratedDebuggingTaskSchema>;

// Debugging grader output. Correctness = did the fix address the root cause;
// minimality = did they change only what's needed. Overall score in [0..1].
export const DebuggingGradeSchema = z.object({
  score: z.number().min(0).max(1),
  correctness: z.number().min(0).max(1),
  minimality: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(1000),
});
export type DebuggingGrade = z.infer<typeof DebuggingGradeSchema>;

// LLM-generated build task. Candidate implements `starter` → test harness runs
// `tests` against their implementation inside the sandbox. Harness contract:
// every test prints exactly one of `PASS <name>` or `FAIL <name>` to stdout,
// one line per test, no other markers. Grader parses PASS/FAIL counts for
// score = passed / total. `description` + examples go in the prompt; `tests`
// are the hidden answer key (never shown pre-grade).
export const GeneratedBuildTaskSchema = z.object({
  language: z.enum(['node', 'python', 'go', 'typescript']),
  title: z.string().min(4).max(120),
  description: z.string().min(20).max(2000),
  starter: z.string().min(0).max(4000),
  tests: z.string().min(20).max(4000),
  timeoutMs: z.number().int().min(1000).max(30_000).default(10_000),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});
export type GeneratedBuildTask = z.infer<typeof GeneratedBuildTaskSchema>;

// LLM-generated mock interview: 3 questions (2 technical + 1 behavioral).
// Each carries its own keyPoints so the grader can score per-Q. Interview
// runs single-turn — user submits all 3 answers at once.
export const MockInterviewQuestionSchema = z.object({
  kind: z.enum(['technical', 'behavioral']),
  prompt: z.string().min(20).max(500),
  keyPoints: z.array(z.string().min(2).max(80)).min(1).max(5),
});
export const GeneratedMockInterviewSchema = z.object({
  scenario: z.string().min(10).max(300),
  questions: z.array(MockInterviewQuestionSchema).length(3),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});
export type GeneratedMockInterview = z.infer<typeof GeneratedMockInterviewSchema>;

// Grader output. Per-question score + overall + panel-style summary.
export const MockInterviewQuestionGradeSchema = z.object({
  index: z.number().int().min(0).max(2),
  score: z.number().min(0).max(1),
  hits: z.array(z.string()).default([]),
  misses: z.array(z.string()).default([]),
  notes: z.string().min(1).max(400),
});
export const MockInterviewGradeSchema = z.object({
  score: z.number().min(0).max(1),
  questions: z.array(MockInterviewQuestionGradeSchema).length(3),
  reasoning: z.string().min(1).max(1000),
});
export type MockInterviewGrade = z.infer<typeof MockInterviewGradeSchema>;

// Grader output. `precision = correct_findings / total_findings`, `recall =
// correct_findings / total_defects`, `score = F1`. `hits[]` are defects the
// reviewer caught (echo the defect text); `misses[]` are defects they didn't.
export const CodeReviewGradeSchema = z.object({
  score: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  recall: z.number().min(0).max(1),
  hits: z.array(z.string()).default([]),
  misses: z.array(z.string()).default([]),
  falsePositives: z.array(z.string()).default([]),
  reasoning: z.string().min(1).max(1000),
});
export type CodeReviewGrade = z.infer<typeof CodeReviewGradeSchema>;

export const SetupStateSchema = z.enum([
  'not_started',
  'account_created',
  'provider_configured',
  'provider_verified',
  'embedding_configured',
  'embedding_verified',
  'github_connected',
  'integrations_reviewed',
  'resume_uploaded',
  'facts_reviewed',
  'goals_set',
  'health_verified',
  'recovery_acknowledged',
  'complete',
]);
export type SetupState = z.infer<typeof SetupStateSchema>;

// ---------------------------------------------------------------------------
// Market demand (P3 screens 33 + 34). Derived from persisted `NormalizedJob`
// rows; no news-source ingestion exists yet, so trend signals are computed
// from the same job pool. Empty result = `[]` (documented, never a fixture).
// ---------------------------------------------------------------------------

/**
 * One row of the screen-33 skill-demand table. `postings` counts the jobs in
 * the window that list the skill; `share` is `postings / jobsInWindow`;
 * `history` is the per-bucket posting count across the window (7 buckets);
 * `gap` is the market demand score (`round(share*100)`) minus the caller's
 * demonstrated `CandidateSkillState.level`, floored at 0 — a proxy for
 * "distance to the market threshold" from the evidence model.
 */
export const SkillDemandRowSchema = z.object({
  skillId: z.string().min(1),
  label: z.string().min(1),
  cluster: z.string().min(1),
  postings: z.number().int().nonnegative(),
  share: z.number().min(0).max(1),
  history: z.array(z.number().int().nonnegative()),
  gap: z.number().int(),
});
export type SkillDemandRow = z.infer<typeof SkillDemandRowSchema>;

/** Screen-34 trajectory classification (blueprint §9 trend thresholds). */
export const TrendTrajectorySchema = z.enum(['rising', 'steady', 'declining']);
export type TrendTrajectory = z.infer<typeof TrendTrajectorySchema>;

/**
 * One screen-34 trend signal. `mentions` is the 90-day posting count;
 * `sources` is the number of distinct `NormalizedJob.primarySource` adapters
 * that mentioned it; `firstSeen` is the earliest observed ISO date;
 * `history` is the 7-bucket series across the 90 days.
 */
export const TrendSignalSchema = z.object({
  id: z.string().min(1),
  technology: z.string().min(1),
  category: z.string().min(1),
  mentions: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
  firstSeen: z.string(),
  trajectory: TrendTrajectorySchema,
  history: z.array(z.number().int().nonnegative()),
});
export type TrendSignal = z.infer<typeof TrendSignalSchema>;

/** Response envelopes for the two market-demand endpoints. */
export const SkillDemandResponseSchema = z.object({
  windowDays: z.number().int().positive(),
  rows: z.array(SkillDemandRowSchema),
});
export type SkillDemandResponse = z.infer<typeof SkillDemandResponseSchema>;

export const TrendSignalsResponseSchema = z.object({
  generatedAt: z.string(),
  signals: z.array(TrendSignalSchema),
});
export type TrendSignalsResponse = z.infer<typeof TrendSignalsResponseSchema>;

// ---------------------------------------------------------------------------
// Search providers (P3 screen 56). Providers are the configured job-source
// adapters (registry in `@careeros/job-pipeline`); there is no persisted
// usage counter yet, so `quota`/`used` are null and the UI renders
// "not tracked" rather than an invented number. An empty `providers` array is
// a valid, documented state.
// ---------------------------------------------------------------------------

export const SearchProviderStatusSchema = z.enum(['active', 'standby', 'error']);
export type SearchProviderStatus = z.infer<typeof SearchProviderStatusSchema>;

export const SearchProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  host: z.string(),
  status: SearchProviderStatusSchema,
  /** ISO date of the first persisted job from this source, or null if none. */
  addedAt: z.string().nullable(),
  /** Human-readable scope / declared rate ceiling from `RATE_LIMITS`. */
  usage: z.string(),
  /** Monthly request budget; null = usage tracking not persisted. */
  quota: z.number().int().nonnegative().nullable(),
  /** Requests used this month; null = usage tracking not persisted. */
  used: z.number().int().nonnegative().nullable(),
  authNote: z.string(),
});
export type SearchProvider = z.infer<typeof SearchProviderSchema>;

export const SearchProviderWorkloadSchema = z.object({
  workload: z.string().min(1),
  provider: z.string().min(1),
  schedule: z.string().min(1),
});
export type SearchProviderWorkload = z.infer<typeof SearchProviderWorkloadSchema>;

export const SearchProvidersResponseSchema = z.object({
  providers: z.array(SearchProviderSchema),
});
export type SearchProvidersResponse = z.infer<typeof SearchProvidersResponseSchema>;

export const SearchProviderWorkloadsResponseSchema = z.object({
  workloads: z.array(SearchProviderWorkloadSchema),
});
export type SearchProviderWorkloadsResponse = z.infer<typeof SearchProviderWorkloadsResponseSchema>;
