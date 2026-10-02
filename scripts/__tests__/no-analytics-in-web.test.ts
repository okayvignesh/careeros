// security.md item 6: "No analytics SDK in web." A sibling test at
// apps/web/src/no-analytics-sdk.test.ts guards the DIRECT deps of
// apps/web/package.json. This test is the TRANSITIVE guard: it scans the
// pnpm-lock.yaml `packages:` section for the same blocklist, so a sneaky
// indirect dep (e.g. a UI library pulling in posthog-js) still fails CI.
//
// Why two tests: the direct guard is the human-readable one developers see
// first; the transitive guard is the one supply-chain surprises trip.
//
// ponytail: blocklist additions welcomed; current set covers the common web
// analytics / session-recording / tag-manager SDKs seen in the wild. Add a
// package name string + rerun. If analytics scanning grows past a few
// hundred names consider loading from a JSON asset, but today a const array
// is one line to extend and zero deps.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const LOCKFILE = resolve(REPO_ROOT, 'pnpm-lock.yaml');
const WEB_PKG = resolve(REPO_ROOT, 'apps/web/package.json');

// Minimum blocklist (per task spec + security.md item 6). Patterns ending in
// `/*` match the whole scope. @sentry/* is EXCLUDED deliberately: we use
// self-hosted Sentry/GlitchTip for error tracking, not product analytics.
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

interface Finding {
  pkg: string;
  version: string;
  kind: 'direct' | 'transitive';
}

function readDirectWebDeps(): Set<string> {
  const pkg = JSON.parse(readFileSync(WEB_PKG, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
}

// Parse the `packages:` section of pnpm-lock v9. Format is predictable:
//   packages:
//     '<name>@<version>':
//       resolution: {...}
// We stop at the next top-level section (`snapshots:` et al). Regex over
// text beats pulling in js-yaml for this one shape; the lockfile is
// authoritative and pnpm's writer is stable.
function readLockedPackages(): Array<{ name: string; version: string }> {
  const text = readFileSync(LOCKFILE, 'utf8');
  const lines = text.split('\n');
  const out: Array<{ name: string; version: string }> = [];
  let inPackages = false;
  // Two shapes under `packages:` in pnpm-lock v9:
  //   quoted (scoped or special-char names):   `  '@foo/bar@1.2.3':`
  //   unquoted (plain names):                   `  react-dom@19.3.0:`
  // Peer-dep suffixes like `(react@19.3.0)` are stripped from the version.
  const quoted = /^ {2}'([^']+)':$/;
  const unquoted = /^ {2}([a-z0-9][^@:'\s]*@[^:'\s]+):$/i;
  for (const line of lines) {
    if (line === 'packages:') {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    // Any new top-level key (no leading space) ends the section.
    if (line.length > 0 && !line.startsWith(' ') && line.endsWith(':')) break;
    const m = quoted.exec(line) ?? unquoted.exec(line);
    if (!m) continue;
    const spec = m[1];
    const at = spec.lastIndexOf('@');
    if (at <= 0) continue;
    const name = spec.slice(0, at);
    const rawVersion = spec.slice(at + 1);
    const paren = rawVersion.indexOf('(');
    const version = paren === -1 ? rawVersion : rawVersion.slice(0, paren);
    out.push({ name, version });
  }
  return out;
}

describe('no analytics SDK reachable from apps/web (direct + transitive)', () => {
  const direct = readDirectWebDeps();
  const locked = readLockedPackages();

  it('matchesBlocklist self-check (positive + negative cases)', () => {
    // Guards against a disabled blocklist (empty array / typo) silently
    // passing the real assertions. If this test fails the scanner is broken,
    // not the lockfile.
    expect(matchesBlocklist('posthog-js')).toBe(true);
    expect(matchesBlocklist('@amplitude/analytics-browser')).toBe(true);
    expect(matchesBlocklist('@sentry/nextjs')).toBe(false);
    expect(matchesBlocklist('react')).toBe(false);
    expect(matchesBlocklist('@amplitudeish/not-really')).toBe(false);
  });

  it('lockfile parser finds packages (sanity: non-empty)', () => {
    // A silently-empty parse would make the main assertion pass vacuously.
    expect(locked.length).toBeGreaterThan(100);
  });

  it('no blocked analytics SDK appears in apps/web/package.json or pnpm-lock.yaml', () => {
    const findings: Finding[] = [];
    for (const { name, version } of locked) {
      if (!matchesBlocklist(name)) continue;
      findings.push({
        pkg: name,
        version,
        kind: direct.has(name) ? 'direct' : 'transitive',
      });
    }
    // Dedupe by name+kind (multiple versions of the same package possible).
    const unique = new Map<string, Finding>();
    for (const f of findings) {
      const key = `${f.pkg}@${f.version}:${f.kind}`;
      if (!unique.has(key)) unique.set(key, f);
    }
    const sorted = [...unique.values()].sort((a, b) => a.pkg.localeCompare(b.pkg));
    expect(
      sorted,
      [
        'Blocked analytics SDK present (security.md item 6).',
        'Each line is <package>@<version> [direct|transitive].',
        'Direct hit: remove from apps/web/package.json.',
        'Transitive hit: find the ancestor via `pnpm why <package>` and swap or lock it out.',
        '',
        ...sorted.map((f) => `  - ${f.pkg}@${f.version} [${f.kind}]`),
      ].join('\n'),
    ).toEqual([]);
  });
});
