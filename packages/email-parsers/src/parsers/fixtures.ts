// Test-only fixture loader shared by the three parser suites. Iterates a
// fixtures dir, pairs `<name>.html` with `<name>.expected.json`, and yields
// { name, html, expected, meta } tuples. `.meta.json` is optional and lets a
// fixture override subject/from/receivedAt away from the defaults.
//
// NOT part of the public package surface — imported only from *.test.ts files
// which the build tsconfig already excludes.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedEmail } from '../types';

export interface FixtureCase {
  name: string;
  html: string;
  expected: ParsedEmail;
  meta: FixtureMeta;
}

export interface FixtureMeta {
  from: string;
  subject: string;
  receivedAt: string;
}

export function loadFixtures(dir: string, defaults: FixtureMeta): FixtureCase[] {
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort();
  const cases: FixtureCase[] = [];
  for (const file of entries) {
    const name = file.replace(/\.html$/, '');
    const html = readFileSync(join(dir, file), 'utf-8');
    const expectedRaw = readFileSync(join(dir, `${name}.expected.json`), 'utf-8');
    const expected = reviveDates(JSON.parse(expectedRaw)) as ParsedEmail;
    const metaPath = join(dir, `${name}.meta.json`);
    const meta: FixtureMeta = safeExists(metaPath)
      ? { ...defaults, ...(JSON.parse(readFileSync(metaPath, 'utf-8')) as Partial<FixtureMeta>) }
      : defaults;
    cases.push({ name, html, expected, meta });
  }
  return cases;
}

function safeExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

// Expected JSON stores dates as ISO strings; hydrate to Date so `toEqual`
// against the parser's Date output matches.
function reviveDates(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(reviveDates);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if ((k === 'receivedAt' || k === 'postedAt') && typeof v === 'string') {
      out[k] = new Date(v);
    } else {
      out[k] = reviveDates(v);
    }
  }
  return out;
}
