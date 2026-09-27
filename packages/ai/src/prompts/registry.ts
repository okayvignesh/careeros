// Central prompt registry. Every registered prompt is a `PromptDef`; consumers get
// a `RenderedPrompt` via `renderPrompt(id, vars)` which fills `{{placeholders}}` and
// stamps a stable SHA-256 hash of the (id, version, system, userTemplate) tuple.
//
// The registry is intentionally a flat map, not a filesystem scan: the boot startup
// check reads it once and refuses to start if a prompt id is missing a version or a
// hash duplicate is detected.
import { createHash } from 'node:crypto';
import type { ZodTypeAny } from 'zod';
import type { PromptDef, RenderedPrompt } from './types';

const REGISTRY = new Map<string, PromptDef>();

/** Register a prompt at module load. Called from `prompts/index.ts`. */
export function register<S extends ZodTypeAny>(def: PromptDef<S>): PromptDef<S> {
  if (REGISTRY.has(def.id)) {
    throw new Error(`Prompt id '${def.id}' already registered; did you import twice?`);
  }
  REGISTRY.set(def.id, def as unknown as PromptDef);
  return def;
}

export function getPrompt(id: string): PromptDef {
  const def = REGISTRY.get(id);
  if (!def) throw new Error(`Prompt id '${id}' not in registry`);
  return def;
}

export function allPrompts(): PromptDef[] {
  return [...REGISTRY.values()];
}

export function promptHash(def: PromptDef): string {
  const material = JSON.stringify({
    id: def.id,
    version: def.version,
    system: def.system,
    userTemplate: def.userTemplate,
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/**
 * Fill `{{placeholders}}` in the user template. Placeholders must appear in `vars`;
 * a missing variable throws so a prompt never silently ships with `{{fact}}` literal.
 */
export function renderPrompt<S extends ZodTypeAny>(
  id: string,
  vars: Record<string, string>,
): RenderedPrompt<S> {
  const def = getPrompt(id) as PromptDef<S>;
  const user = def.userTemplate.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in vars)) {
      throw new Error(`Prompt '${id}' missing variable '{{${name}}}'`);
    }
    return vars[name] as string;
  });
  return {
    id: def.id,
    version: def.version,
    hash: promptHash(def),
    system: def.system,
    user,
    schema: def.schema,
  };
}
