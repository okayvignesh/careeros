// security.md item 6: "No analytics SDK in web." This is the DIRECT-deps
// guard for apps/web/package.json. The transitive guard lives at
// scripts/__tests__/no-analytics-in-web.test.ts and scans pnpm-lock.yaml.
//
// Why two tests: this is the human-readable one developers see first; the
// transitive guard is the one supply-chain surprises trip.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB_PKG = resolve(__dirname, '..', 'package.json');

// Kept in sync with scripts/__tests__/no-analytics-in-web.test.ts. Patterns
// ending in `/*` match the whole scope. @sentry/* is EXCLUDED deliberately:
// we use self-hosted Sentry/GlitchTip for error tracking, not product analytics.
const BLOCKLIST: readonly string[] = [
  // google
  '@google-analytics/*',
  'gtag',
  'ga-gtag',
  'react-ga',
  'react-ga4',
  'next-ga',
  'google-tag-manager',
  'react-gtm-module',
  '@next/third-parties',
  // segment
  '@segment/*',
  'analytics-node',
  // mixpanel
  'mixpanel',
  'mixpanel-browser',
  // posthog
  'posthog-js',
  'posthog-node',
  // amplitude
  'amplitude-js',
  '@amplitude/*',
  // heap
  'heap-analytics',
  'heap-js',
  // fullstory
  'fullstory',
  '@fullstory/*',
  'fullstory-react',
  // hotjar
  'hotjar',
  '@hotjar/*',
  // vercel analytics
  '@vercel/analytics',
  // datadog RUM (analytics-flavoured; APM is fine but RUM phones every click)
  '@datadog/browser-rum',
  'rum-js',
  // session recording
  'logrocket',
  'logrocket-react',
  // customer messaging (not strictly analytics but phone-home + session capture)
  'intercom-client',
  '@intercom/*',
  // ad / tracking pixels
  'react-facebook-pixel',
  'react-pixel',
];

function matchesBlocklist(pkg: string): boolean {
  for (const rule of BLOCKLIST) {
    if (rule.endsWith('/*')) {
      const scope = rule.slice(0, -2);
      if (pkg === scope || pkg.startsWith(`${scope}/`)) return true;
    } else if (pkg === rule) {
      return true;
    }
  }
  return false;
}

interface WebManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readDirectWebDeps(): string[] {
  const pkg = JSON.parse(readFileSync(WEB_PKG, 'utf8')) as WebManifest;
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];
}

describe('no analytics SDK in apps/web direct deps (security.md item 6)', () => {
  it('matchesBlocklist self-check (positive + negative cases)', () => {
    // Guards against a disabled blocklist (empty array / typo) silently
    // passing the real assertion. If this fails the scanner is broken, not
    // apps/web/package.json.
    expect(matchesBlocklist('posthog-js')).toBe(true);
    expect(matchesBlocklist('@amplitude/analytics-browser')).toBe(true);
    expect(matchesBlocklist('@sentry/nextjs')).toBe(false);
    expect(matchesBlocklist('react')).toBe(false);
    expect(matchesBlocklist('@amplitudeish/not-really')).toBe(false);
  });

  it('no dependency field (incl. optional/peer) contains a blocked analytics SDK', () => {
    const offenders = readDirectWebDeps()
      .filter(matchesBlocklist)
      .sort((a, b) => a.localeCompare(b));
    expect(
      offenders,
      [
        'Blocked analytics SDK present in apps/web/package.json (security.md item 6).',
        'Remove each offending package:',
        ...offenders.map((pkg) => `  - ${pkg}`),
      ].join('\n'),
    ).toEqual([]);
  });
});
