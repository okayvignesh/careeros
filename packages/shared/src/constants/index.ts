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
