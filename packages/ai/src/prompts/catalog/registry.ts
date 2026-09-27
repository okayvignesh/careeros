// C-P0.2b: version-aware Prompt catalog registry. Distinct from the runtime
// `PromptDef` registry in ../registry.ts — this one tracks the (id, version)
// pair as an audit surface (hashOf + hash-log + CI version-bump gate).
// Runtime prompt rendering still goes through ../registry.ts's `renderPrompt`.
//
// Ponytail: SHA-256 via node:crypto stdlib. No hashing libs.
import { createHash } from 'node:crypto';

export interface Prompt {
  id: string;
  version: string;
  template: string;
  schemaVersion?: string;
  description?: string;
}

export interface PromptInfo {
  id: string;
  version: string;
  hash: string;
  schemaVersion?: string;
  description?: string;
}

/**
 * Canonicalize a Prompt for hashing. Only id + version + template contribute —
 * description/schemaVersion are metadata for humans and are excluded so a
 * doc-only edit doesn't force a version bump (a template edit does).
 */
function hashMaterial(prompt: Prompt): string {
  return `${prompt.id}@${prompt.version}\n${prompt.template}`;
}

export class PromptRegistry {
  // (id -> version -> Prompt). Version-aware: multiple versions of the same
  // id can coexist so audit rows against `resolve(id, oldVersion)` still work
  // after a bump.
  private readonly entries = new Map<string, Map<string, Prompt>>();

  /**
   * Idempotent: re-registering the identical (id, version, template) is a
   * no-op. Registering the same (id, version) with a different template
   * throws — that's the version-bump violation the CI gate also catches.
   */
  register(prompt: Prompt): void {
    if (!prompt.id) throw new Error('prompt.id required');
    if (!prompt.version) throw new Error(`prompt '${prompt.id}' missing version`);
    if (!prompt.template) throw new Error(`prompt '${prompt.id}@${prompt.version}' missing template`);

    let byVersion = this.entries.get(prompt.id);
    if (!byVersion) {
      byVersion = new Map();
      this.entries.set(prompt.id, byVersion);
    }
    const existing = byVersion.get(prompt.version);
    if (existing) {
      if (PromptRegistry.hashOf(existing) === PromptRegistry.hashOf(prompt)) {
        return; // idempotent re-register (module reload / test)
      }
      throw new Error(
        `prompt '${prompt.id}@${prompt.version}' already registered with different content; bump version`,
      );
    }
    byVersion.set(prompt.version, prompt);
  }

  /**
   * Resolve a prompt. When `version` is omitted, returns the highest-semver
   * version registered — sorted lexicographically over dot-separated numeric
   * segments (ponytail: naive numeric compare, upgrade to `semver` package if
   * we ever need pre-release / build metadata support).
   */
  resolve(id: string, version?: string): Prompt {
    const byVersion = this.entries.get(id);
    if (!byVersion || byVersion.size === 0) {
      throw new Error(`prompt '${id}' not registered`);
    }
    if (version !== undefined) {
      const found = byVersion.get(version);
      if (!found) {
        throw new Error(`prompt '${id}@${version}' not registered`);
      }
      return found;
    }
    // Latest version (ponytail: naive semver-ish sort; sufficient for X.Y.Z).
    const latest = [...byVersion.keys()].sort(compareVersions).at(-1)!;
    return byVersion.get(latest)!;
  }

  list(): PromptInfo[] {
    const out: PromptInfo[] = [];
    for (const byVersion of this.entries.values()) {
      for (const prompt of byVersion.values()) {
        out.push({
          id: prompt.id,
          version: prompt.version,
          hash: PromptRegistry.hashOf(prompt),
          ...(prompt.schemaVersion !== undefined ? { schemaVersion: prompt.schemaVersion } : {}),
          ...(prompt.description !== undefined ? { description: prompt.description } : {}),
        });
      }
    }
    return out;
  }

  /** SHA-256 of `<id>@<version>\n<template>` (deterministic). */
  static hashOf(prompt: Prompt): string {
    return createHash('sha256').update(hashMaterial(prompt)).digest('hex');
  }

  /** Test hook. Not for production wiring. */
  clear(): void {
    this.entries.clear();
  }
}

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
