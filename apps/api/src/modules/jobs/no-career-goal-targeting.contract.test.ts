import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * job-targeting §4 acceptance: `CareerGoal` stops being a read source for
 * targeting. `UserJobPreferences` is the single canonical profile. Goals may
 * still be enumerated for user ids (the F8 sweep), but no code may read
 * `goal.targetRoles` / `goal.locations` / `goal.remoteOnly` / `goal.seniority`.
 *
 * Contract test over source text so a future reader that re-introduces the
 * split is caught even if no runtime test exercises that branch.
 */
const REPO_ROOT = process.cwd();
const TARGETING_READERS = [
  'apps/api/src/modules/jobs/jobs.service.ts',
  'apps/worker/src/firecrawl-search.worker.ts',
];

const FORBIDDEN = [
  /goal\??\.targetRoles/,
  /goal\??\.locations/,
  /goal\??\.remoteOnly/,
  /goal\??\.seniority/,
  /g\."?targetRoles/,
  /g\."?locations/,
];

describe('targeting reads — CareerGoal is no longer a target source', () => {
  for (const rel of TARGETING_READERS) {
    it(`${rel} does not read goal targeting fields`, () => {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf8');
      for (const pattern of FORBIDDEN) {
        expect(source).not.toMatch(pattern);
      }
    });
  }

  it('jobs.service reads targeting from JobPreferencesService', () => {
    const source = readFileSync(join(REPO_ROOT, TARGETING_READERS[0]!), 'utf8');
    expect(source).toMatch(/this\.prefs\.get\(/);
  });
});
