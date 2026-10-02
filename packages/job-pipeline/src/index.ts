export * from './types';
export {
  adapters,
  remotiveAdapter,
  ashbyAdapter,
  greenhouseAdapter,
  adzunaAdapter,
  arbeitnowAdapter,
  firecrawlAdapter,
  workdayAdapter,
  createAshbyAdapter,
  createGreenhouseAdapter,
  createAdzunaAdapter,
  createArbeitnowAdapter,
  createFirecrawlAdapter,
  createWorkdayAdapter,
  mapRemotive,
  mapAshby,
  mapGreenhouse,
  mapAdzuna,
  mapArbeitnow,
  mapFirecrawl,
  mapWorkday,
  isBannedPlatformUrl,
  companyFromUrl,
  firecrawlRateLimit,
  workdayRateLimit,
  parseWorkdayPosted,
  inferWorkdayRemote,
  FIRECRAWL_TRUST_TIER,
  FIRECRAWL_SOURCE_NAME,
  WORKDAY_SOURCE_NAME,
  WORKDAY_TRUST_TIER_UNVERIFIED,
  WORKDAY_TRUST_TIER_VERIFIED,
  WORKDAY_DEFAULT_PAGE_SIZE,
  AdapterError,
  MalformedResponseError,
  MissingCredentialError,
  type AshbyAdapterOpts,
  type GreenhouseAdapterOpts,
  type AdzunaAdapterOpts,
  type ArbeitnowAdapterOpts,
  type FirecrawlAdapterOpts,
  type FirecrawlJobClient,
  type WorkdayAdapterOpts,
  type WorkdayJobPosting,
  type WorkdayDetail,
  type WorkdayMapContext,
  type AshbyJob,
  type GreenhouseJob,
  type AdzunaJob,
  type ArbeitnowJob,
  type RemotiveJob,
} from './adapters';
export { normalize, type NormalizedJob, type NormalizeInput } from './stages/normalize';
export {
  classifySeniority,
  type SeniorityLevel,
  type SeniorityResult,
} from './stages/classify-seniority';
export {
  classifyRole,
  type RoleFamily,
  type RoleResult,
} from './stages/classify-role';
export { parseCompBand } from './stages/comp-band';
export {
  convertToUsd,
  convertToUsdBand,
  rates,
  type Money,
  type CompBand,
  type CompBandUsd,
  type RatesSnapshot,
} from './fx/rates';
export { dedupe, type DedupeResult } from './stages/dedupe';
export {
  freshness,
  type FreshnessOpts,
  type FreshnessResult,
  type FreshnessReason,
} from './stages/freshness';
export {
  verify,
  type VerifyOpts,
  type VerifyResult,
  type VerifyVerdict,
} from './stages/verify';
export {
  trustOrder,
  tierFor,
  TIER_BY_ADAPTER,
  type TrustOrderOpts,
} from './stages/trust-order';
export {
  crossSourceDedupe,
  levenshtein,
  type CrossSourceDedupeOpts,
  type CrossSourceDedupeResult,
  type DuplicatePair,
} from './stages/cross-source-dedupe';
export {
  relevance,
  type RelevancePrefs,
  type RelevanceJob,
  type RelevanceOpts,
  type RelevanceReason,
  type RelevanceResult,
} from './stages/relevance';
export {
  computeMatch,
  computeMatchResult,
  type MatchResult,
  type MatchScore,
  type GapItem,
  type EvidenceRef,
  type Explanation,
  type RequiredSkill,
  type ComputeInput,
} from './stages/match';
// Wire-shape schemas per adapter (C-P3.6a). Used by contract tests + optional
// pre-parse guards. The `node:fs`-backed snapshot helpers in schemas.ts are
// intentionally NOT re-exported — they are test-time only.
export {
  RemotiveFeedWire,
  RemotiveJobWire,
  AshbyBoardWire,
  AshbyJobWire,
  GreenhouseBoardWire,
  GreenhouseJobWire,
  AdzunaResponseWire,
  AdzunaJobWire,
  ArbeitnowResponseWire,
  ArbeitnowJobWire,
  WorkdayJobsWire,
  WorkdayJobPostingWire,
  WorkdayDetailWire,
  FirecrawlSearchResponseWire,
  FirecrawlSearchResultWire,
  adapterWireSchemas,
  type AdapterId,
} from './adapters/schemas';
