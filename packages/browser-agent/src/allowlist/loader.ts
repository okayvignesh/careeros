import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * Allowlist entry per domain (PLAN.md line 35: YAML under
 * `packages/browser-agent/allowlist/`). Shared server-side (task validation)
 * and agent-side (Playwright navigation guard + form-fill scripts).
 *
 * Loader reads once at startup; entries are static so no watch/reload path.
 *
 * F.3 adds the optional `field_selectors` + `submit_selector` + `success_signal`
 * + `pacing_overrides` blocks per phase-6:39-43. Existing yaml files without
 * these fields keep validating (they're `.optional()`).
 */
export const FieldSelectors = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    resume_upload: z.string().min(1).optional(),
    cover_letter: z.string().min(1).optional(),
    linkedin_url: z.string().min(1).optional(),
    github_url: z.string().min(1).optional(),
    portfolio_url: z.string().min(1).optional(),
  })
  .partial();
export type FieldSelectors = z.infer<typeof FieldSelectors>;

export const PacingOverrides = z
  .object({
    per_min: z.number().int().positive().optional(),
    min_gap_ms: z.number().int().nonnegative().optional(),
  })
  .partial();
export type PacingOverrides = z.infer<typeof PacingOverrides>;

export const AllowlistEntry = z.object({
  domain: z.string().min(1),
  allowed_paths: z.array(z.string().min(1)),
  forbidden_selectors: z.array(z.string().min(1)),
  required_headers: z.array(z.string().min(1)),
  field_selectors: FieldSelectors.optional(),
  submit_selector: z.string().min(1).optional(),
  success_signal: z.string().min(1).optional(),
  pacing_overrides: PacingOverrides.optional(),
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
