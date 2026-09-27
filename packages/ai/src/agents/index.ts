// Barrel for the agents subsystem. Side-effect free: registration happens
// where concrete agents live (mirrors how DeepSeekProvider wires into
// ProviderRegistry from the api bootstrap, not from packages/ai).
export { AgentRegistry, agentRegistry } from './registry';
export type {
  AgentDef,
  AgentInfo,
  AgentRun,
  AgentInput,
  AgentOutput,
  InferAgentOutput,
  PromptRef,
  ToolSpec,
} from './types';
