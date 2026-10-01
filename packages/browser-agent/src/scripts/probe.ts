/**
 * F.3 selector-health probe for form-fill allowlist entries.
 *
 * Reuses `checkSelectorHealth` from D.5 (same package). For a given
 * allowlist entry, collects every selector that would be used by the
 * form-fill engine (field_selectors + submit_selector + success_signal),
 * runs them against a captured HTML fixture, and returns the per-entry
 * health report.
 *
 * The server-side cron worker (apps/worker/src/selector-health.worker.ts)
 * calls this once per entry per week. If `healthy === false`, it emits an
 * audit_log row with action `form_fill.selector_stale`; the agent's live
 * form-fill path then short-circuits for that domain and routes to the
 * "open in browser to complete" fallback.
 */

import type { AllowlistEntry } from '../allowlist/loader';
import { checkSelectorHealth, type SelectorHealth } from '../selector-health';

export interface ProbeResult extends SelectorHealth {
  domain: string;
  probedSelectors: string[];
}

/**
 * Collect every selector the form-fill engine will use for this entry.
 * Each entry in the returned list is a Playwright-style selector *group*
 * (comma-separated alternatives). Stable order (field_selectors first in
 * declaration order, then submit, then success) so health reports diff
 * cleanly across runs.
 */
export function collectProbeSelectors(entry: AllowlistEntry): string[] {
  const out: string[] = [];
  const fields = entry.field_selectors;
  if (fields) {
    for (const key of [
      'name',
      'email',
      'phone',
      'linkedin_url',
      'github_url',
      'portfolio_url',
      'cover_letter',
      'resume_upload',
    ] as const) {
      const sel = fields[key];
      if (sel) out.push(sel);
    }
  }
  if (entry.submit_selector) out.push(entry.submit_selector);
  if (entry.success_signal) out.push(entry.success_signal);
  return out;
}

/**
 * Probe one entry against one fixture snapshot. Pure fn; the fixture is
 * passed in so the caller controls whether it's a live page.content() or a
 * disk-loaded __fixtures__ bundle.
 *
 * A selector group (comma-separated alternatives) is healthy if ANY alt
 * matches. This mirrors Playwright's native OR behavior and means allowlist
 * yamls can safely list a modern + legacy selector.
 */
export function probeEntry(entry: AllowlistEntry, domSnapshot: string): ProbeResult {
  const selectorGroups = collectProbeSelectors(entry);
  if (selectorGroups.length === 0) {
    return {
      healthy: true,
      missing: [],
      drifted: [],
      domain: entry.domain,
      probedSelectors: [],
    };
  }
  const missing: string[] = [];
  const drifted: string[] = [];
  for (const group of selectorGroups) {
    const alts = splitSelectorGroup(group);
    const altResult = checkSelectorHealth(domSnapshot, alts);
    // Healthy if at least one alt matched (missing.length < alts.length).
    if (altResult.missing.length === alts.length) {
      missing.push(group);
    } else if (altResult.drifted.length === alts.length) {
      drifted.push(group);
    }
  }
  return {
    healthy: missing.length === 0 && drifted.length === 0,
    missing,
    drifted,
    domain: entry.domain,
    probedSelectors: selectorGroups,
  };
}

/**
 * Split a Playwright selector group like `a, b, c` into its alternatives.
 * Doesn't try to be clever about commas inside `[attr="a,b"]` — allowlist
 * selectors don't use that pattern. If they ever do, swap in a real tokenizer.
 *
 * ponytail: naive split, upgrade when a yaml selector legitimately contains
 * a comma inside an attribute value.
 */
function splitSelectorGroup(group: string): string[] {
  return group.split(',').map((s) => s.trim()).filter(Boolean);
}
