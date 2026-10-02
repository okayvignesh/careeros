export type {
  AIProvider,
  ProviderCapabilities,
  ProviderProbeResult,
  ChatMessage,
} from './provider';
export { DeepSeekProvider, type LlmCallRecord, type LlmCallHook } from './providers/deepseek';
export { probeProvider, type ProbeResult } from './probe';
export {
  ProviderRegistry,
  type ProviderFactory,
  type ProviderInfo,
} from './registry';
export { estimateCostUsd } from './pricing';
export {
  wrapUntrusted,
  UNTRUSTED_SYSTEM_CLAUSE,
  setWrapAuditHook,
  type UntrustedSourceKind,
  type Wrapped,
} from './wrap';
export {
  LLMProviderError,
  StructuredOutputError,
  InjectionBlockedError,
  SensitivityBlockedError,
} from './errors';
export {
  classifySensitivity,
  decideProviderEgress,
  assertProviderAllowed,
  isProviderAllowed,
  allowedProviders,
  ceilingRank,
  setSensitivityAuditHook,
  type ProviderCeiling,
  type ProviderPolicy,
  type EgressDecision,
  type SensitivityAuditEvent,
  type ClassifyMeta,
} from './sensitivity-gate';
export {
  scanForInjection,
  auditScan,
  setInjectionAuditHook,
  type InjectionScanResult,
  type InjectionHit,
  type Severity as InjectionSeverity,
} from './injection-scan';
export { findHallucinations, type HallucinationReport } from './hallucination';
export {
  SENSITIVITY_LEVELS,
  defaultSensitivityForSource,
  isAtLeast,
  rankOf,
  type Sensitivity,
} from './sensitivity';
export {
  generateGrounded,
  type GroundedFact,
  type GroundedResult,
  type HallucinationHook,
} from './grounded';
// C-P4.7a: shared fact-check gate (extracted from resume-variants + cover-letters).
// Note: `./grounded` above is the singular `grounded.ts` file; `./grounded/index`
// resolves to the new grounded/ directory barrel — TS module resolution picks
// the file, then falls back to the dir, so an explicit path avoids the shadow.
export {
  runFactCheck,
  renderClaimsForPrompt,
  type CitedFact,
  type Claim as FactCheckClaim,
  type Verdict as FactCheckVerdict,
  type FactCheckOutcome,
  type RunFactCheckOptions,
} from './grounded/gate';
export {
  allPrompts,
  getPrompt,
  promptHash,
  renderPrompt,
  type PromptDef,
  type RenderedPrompt,
  type PromptExample,
} from './prompts';
export {
  InterviewPrepPlanSchema,
  type InterviewPrepPlan,
} from './prompts/interview-prep-planner';
export { TalkTrackSchema, type TalkTrack } from './prompts/talk-track-generator';
export { OutreachDraftSchema, type OutreachDraft } from './prompts/outreach-composer';
export {
  SkillExtractEval,
  KnowledgeGraderEval,
  QuestionGeneratorEval,
  runEval,
  formatReport,
  type CaseRunner,
  type EvalSuite,
  type EvalCase,
  type EvalScore,
  type EvalReport,
} from './evals';
export {
  AgentRegistry,
  agentRegistry,
  runAgent,
  runAgentEvals,
  setAgentAuditHook,
  type AgentDef,
  type AgentInfo,
  type AgentRun,
  type ToolSpec,
  type PromptRef,
  type AgentInput,
  type AgentOutput,
  type InferAgentOutput,
  type AgentAuditEvent,
  type AgentAuditHook,
  type AgentRunContext,
  type AgentEval,
  type AgentEvalJudge,
  type AgentEvalScore,
  type AgentEvalArtifacts,
} from './agents';
