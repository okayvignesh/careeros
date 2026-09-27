import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * Allowlist entry per domain (PLAN.md line 35: YAML under
 * `packages/browser-agent/allowlist/`). Shared server-side (task validation)
 * and agent-side (Playwright navigation guard).
 *
 * Loader reads once at startup; entries are static so no watch/reload path.
 */
export const AllowlistEntry = z.object({
  domain: z.string().min(1),
  allowed_paths: z.array(z.string().min(1)),
  forbidden_selectors: z.array(z.string().min(1)),
  required_headers: z.array(z.string().min(1)),
});
export type AllowlistEntry = z.infer<typeof AllowlistEntry>;

export function loadAllowlistFile(path: string): AllowlistEntry {
  // readFileSync throws ENOENT — let it propagate; caller (startup) should fail loud.
  const raw = readFileSync(path, 'utf8');
  const parsed = parse(raw);
  return AllowlistEntry.parse(parsed);
}

export function loadAllowlistDir(dir: string): Map<string, AllowlistEntry> {
  const out = new Map<string, AllowlistEntry>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
    const entry = loadAllowlistFile(join(dir, name));
    out.set(entry.domain, entry);
  }
  return out;
}

/**
 * Default location — PLAN.md line 35 pins the yaml files at
 * `packages/browser-agent/allowlist/`. From the compiled loader
 * (`dist/allowlist/loader.js`) that's `../../allowlist`; from the ts source
 * during vitest (`src/allowlist/loader.ts`) it's also `../../allowlist`. Same
 * relative path either way, no build-time copy step needed.
 */
export function defaultAllowlistDir(): string {
  return join(__dirname, '..', '..', 'allowlist');
}
