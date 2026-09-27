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
  SensitivityGate,
  SENSITIVITY_LEVELS as SENSITIVITY_GATE_LEVELS,
  setSensitivityAuditHook,
  type SensitivityLevel,
  type SensitivityContext,
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
  type AgentDef,
  type AgentInfo,
  type AgentRun,
  type ToolSpec,
  type PromptRef,
  type AgentInput,
  type AgentOutput,
  type InferAgentOutput,
} from './agents';
// runAgent / setAgentAuditHook / runAgentEvals are exported in later C-P2.8
// commits alongside orchestrator.ts + eval-set.ts.
