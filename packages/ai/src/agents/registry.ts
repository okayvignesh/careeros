// C-P2.8a: AgentRegistry. Mirror of ProviderRegistry (packages/ai/src/
// registry.ts) but for AgentDefs. Version-aware because agents evolve
// independently (a v1.0 grader run's audit row must still resolve after v1.1
// ships). SEPARATE from ProviderRegistry by design: agents own IO contract +
// prompt binding; providers own the transport. Different lifecycles.
//
// Ponytail: SHA-256 identity check via JSON.stringify(agent-shape) — good
// enough to catch "same id+version, different code" without a full structural
// diff. Upgrade to a deep-equal only if a real duplicate slips through.
import { createHash } from 'node:crypto';
import type { AgentDef, AgentInfo } from './types';

function identityMaterial(agent: AgentDef): string {
  return JSON.stringify({
    id: agent.id,
    version: agent.version,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    // Zod schemas are functions; toString gives a stable-ish signature. Any
    // real schema swap changes the description or bumps the version anyway.
    inputSchema: String(agent.inputSchema?.constructor?.name ?? ''),
    outputSchema: String(agent.outputSchema?.constructor?.name ?? ''),
    maxTokens: agent.maxTokens ?? null,
    temperature: agent.temperature ?? null,
    provider: agent.provider ?? null,
    tools: (agent.tools ?? []).map((t) => t.name).sort(),
  });
}

function hashOf(agent: AgentDef): string {
  return createHash('sha256').update(identityMaterial(agent)).digest('hex');
}

export class AgentRegistry {
  // id -> version -> AgentDef. Version-aware exactly like PromptRegistry.
  private readonly entries = new Map<string, Map<string, AgentDef>>();

  /**
   * Register an agent. Idempotent on identical (id, version, content) — the
   * common case of "test file re-imports the same module". Different content
   * on the same (id, version) throws so a silent behaviour change never lands.
   */
  register(agent: AgentDef): void {
    if (!agent.id) throw new Error('agent.id required');
    if (!agent.version) throw new Error(`agent '${agent.id}' missing version`);
    if (!agent.inputSchema) throw new Error(`agent '${agent.id}@${agent.version}' missing inputSchema`);
    if (!agent.outputSchema) throw new Error(`agent '${agent.id}@${agent.version}' missing outputSchema`);

    let byVersion = this.entries.get(agent.id);
    if (!byVersion) {
      byVersion = new Map();
      this.entries.set(agent.id, byVersion);
    }
    const existing = byVersion.get(agent.version);
    if (existing) {
      if (hashOf(existing) === hashOf(agent)) return; // idempotent
      throw new Error(
        `agent '${agent.id}@${agent.version}' already registered with different content; bump version`,
      );
    }
    byVersion.set(agent.version, agent);
  }

  /**
   * Resolve an agent. Latest semver-ish version when `version` omitted;
   * matches PromptRegistry.resolve behaviour.
   */
  resolve<A extends AgentDef = AgentDef>(id: string, version?: string): A {
    const byVersion = this.entries.get(id);
    if (!byVersion || byVersion.size === 0) {
      throw new Error(`agent '${id}' not registered`);
    }
    if (version !== undefined) {
      const found = byVersion.get(version);
      if (!found) throw new Error(`agent '${id}@${version}' not registered`);
      return found as A;
    }
    const latest = [...byVersion.keys()].sort(compareVersions).at(-1)!;
    return byVersion.get(latest)! as A;
  }

  list(): AgentInfo[] {
    const out: AgentInfo[] = [];
    for (const byVersion of this.entries.values()) {
      for (const agent of byVersion.values()) {
        out.push({
          id: agent.id,
          version: agent.version,
          description: agent.description,
          ...(agent.provider !== undefined ? { provider: agent.provider } : {}),
          tools: (agent.tools ?? []).map((t) => t.name),
        });
      }
    }
    return out;
  }

  /** SHA-256 identity of the registered shape. Exposed for tests + audit. */
  static hashOf(agent: AgentDef): string {
    return hashOf(agent);
  }

  /** Test hook. Not for production wiring. */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * Default composition-root registry. Agent modules can register on load
 * (mirrors promptCatalog in prompts/catalog/index.ts). API bootstrap can also
 * construct its own AgentRegistry and pass it explicitly to the orchestrator
 * — the default is a convenience, not a requirement.
 */
export const agentRegistry = new AgentRegistry();

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}
