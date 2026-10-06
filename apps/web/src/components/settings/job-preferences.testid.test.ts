import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * P1 job-targeting §10 acceptance: every interactive control in the targeting
 * settings panel carries a `data-testid` so the Playwright golden flow can
 * drive it without CSS/text selectors (AGENTS §9).
 */
const PANEL = join(process.cwd(), 'apps/web/src/components/settings/JobPreferencesPanel.tsx');
const source = readFileSync(PANEL, 'utf8');

const LITERAL_TESTIDS = [
  'prefs-target-roles',
  'prefs-remote-only',
  'prefs-countries',
  'prefs-city-add',
  'prefs-home-country',
  'prefs-citizenships',
  'prefs-work-authorizations',
  'prefs-sponsorship-countries',
  'prefs-relocation-willing',
  'prefs-relocation-countries',
  'prefs-currency',
  'prefs-save',
];

// Enum/city controls are rendered in a map with a template-literal test id.
const TESTID_PREFIXES = [
  'prefs-seniority-',
  'prefs-workplace-',
  'prefs-remote-scope-',
  'prefs-city-country-',
  'prefs-city-name-',
  'prefs-city-remove-',
];

describe('JobPreferencesPanel — P1 control test ids', () => {
  for (const id of LITERAL_TESTIDS) {
    it(`has test id "${id}"`, () => {
      // Direct controls pass `data-testid`; helper components (CsvInput) take a
      // `testId` prop that renders `data-testid` internally.
      const present = source.includes(`data-testid="${id}"`) || source.includes(`testId="${id}"`);
      expect(present).toBe(true);
    });
  }

  for (const prefix of TESTID_PREFIXES) {
    it(`renders template test ids with prefix "${prefix}"`, () => {
      expect(source).toContain('`' + prefix);
    });
  }

  it('wires a test id for every control on the panel', () => {
    const direct = (source.match(/data-testid=/g) ?? []).length;
    const viaProp = (source.match(/testId=/g) ?? []).length;
    expect(direct + viaProp).toBeGreaterThanOrEqual(18);
  });
});
