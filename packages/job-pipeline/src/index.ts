export * from './types';
export {
  adapters,
  remotiveAdapter,
  ashbyAdapter,
  greenhouseAdapter,
  adzunaAdapter,
  arbeitnowAdapter,
  createAshbyAdapter,
  createGreenhouseAdapter,
  createAdzunaAdapter,
  createArbeitnowAdapter,
  mapRemotive,
  mapAshby,
  mapGreenhouse,
  mapAdzuna,
  mapArbeitnow,
  AdapterError,
  MalformedResponseError,
  MissingCredentialError,
  type AshbyAdapterOpts,
  type GreenhouseAdapterOpts,
  type AdzunaAdapterOpts,
  type ArbeitnowAdapterOpts,
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
  adapterWireSchemas,
  type AdapterId,
} from './adapters/schemas';
