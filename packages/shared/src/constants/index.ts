export * from './geo';

export const APP_NAME = 'Career OS';
export const SETUP_ROUTE = '/setup';
export const DASHBOARD_ROUTE = '/dashboard';
export const SIGN_IN_ROUTE = '/sign-in';

export const SENSITIVITY_LEVELS = ['public', 'personal', 'confidential', 'employer-confidential'] as const;
export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];

export const SETUP_STEPS = [
  { slug: '01-preflight', title: 'Preflight', section: 'Account' },
  { slug: '02-account', title: 'Create account', section: 'Account' },
  { slug: '03-provider', title: 'AI provider', section: 'Account' },
  { slug: '04-capability', title: 'Capability test', section: 'Account' },
  { slug: '05-embedding', title: 'Embedding mode', section: 'Data' },
  { slug: '06-embedding-test', title: 'Embedding test', section: 'Data' },
  { slug: '07-github', title: 'GitHub', section: 'Data' },
  { slug: '08-integrations', title: 'Integrations', section: 'Data' },
  { slug: '09-resume', title: 'Resume', section: 'Profile' },
  { slug: '10-fact-review', title: 'Fact review', section: 'Profile' },
  { slug: '11-goals', title: 'Career goals', section: 'Profile' },
  { slug: '12-health', title: 'Health check', section: 'Finish' },
  { slug: '13-recovery', title: 'Recovery key', section: 'Finish' },
  { slug: '14-complete', title: 'Complete', section: 'Finish' },
] as const;

export const SETUP_SECTIONS = ['Account', 'Data', 'Profile', 'Finish'] as const;

/**
 * Map from `SetupStateRow.state` (what the user has *completed*) to the slug
 * of the *next* wizard step they should be on. Any state ahead of this slug is
 * URL-jump and gets redirected back. `complete` maps to null (send them to
 * /dashboard, never back into the wizard). Kept next to SETUP_STEPS so a step
 * addition/rename can't silently drift from the state machine.
 * ponytail: single source of truth; middleware + guards import this instead
 * of duplicating the mapping.
 * 'not_started' points at '02-account' because '01-preflight' is a pure
 * browser-capability check (no POST). The user is allowed on either — see
 * allowedSetupSlugs — but the *next actionable* step is account creation.
 */
export const SETUP_STATE_TO_SLUG: Record<string, string | null> = {
  not_started: '02-account',
  account_created: '03-provider',
  provider_configured: '04-capability',
  provider_verified: '05-embedding',
  embedding_configured: '06-embedding-test',
  embedding_verified: '07-github',
  github_connected: '08-integrations',
  integrations_reviewed: '09-resume',
  resume_uploaded: '10-fact-review',
  facts_reviewed: '11-goals',
  goals_set: '12-health',
  health_verified: '13-recovery',
  recovery_acknowledged: '14-complete',
  complete: null,
};

/**
 * Slugs the user is currently allowed to view given their completed state.
 * They can always re-visit anything they've already passed (edit their answer)
 * plus the current step. They cannot skip ahead.
 * `complete` returns [] — /setup/* is off-limits once done, /dashboard owns them.
 */
export function allowedSetupSlugs(state: string): readonly string[] {
  if (state === 'complete') return [];
  const currentSlug = SETUP_STATE_TO_SLUG[state] ?? '01-preflight';
  const currentIdx = SETUP_STEPS.findIndex((s) => s.slug === currentSlug);
  if (currentIdx < 0) return [SETUP_STEPS[0]!.slug];
  return SETUP_STEPS.slice(0, currentIdx + 1).map((s) => s.slug);
}
