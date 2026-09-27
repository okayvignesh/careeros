import type { CorpusAdapter, CorpusItem } from '../types';
import { hashPrompt } from '../hash';

/**
 * Adapter for mtdvio/every-programmer-should-know (CC0-1.0, public domain).
 * LICENSE: https://github.com/mtdvio/every-programmer-should-know/blob/master/LICENSE
 *
 * The README is a bulleted list of topics every programmer should know. We
 * mine bullets that end in `?` OR start with an interrogative starter word
 * (same heuristic as the primer adapter — it survives markdown link decoration
 * where `?` was omitted). Each becomes a `knowledge`-style question rooted at
 * the linked reading. CC0 means no attribution string is legally required,
 * but we keep one anyway so operators can trace provenance in the UI.
 */

const README_URL =
  'https://raw.githubusercontent.com/mtdvio/every-programmer-should-know/master/README.md';

const STARTERS =
  /^(what\b|why\b|how\b|when\b|where\b|which\b|explain|describe|design|implement|build|create|write)/i;

export const everyProgrammerShouldKnowAdapter: CorpusAdapter = {
  id: 'every-programmer-should-know',
  name: 'Every Programmer Should Know',
  license: 'CC0-1.0',
  sourceUrl: 'https://github.com/mtdvio/every-programmer-should-know',
  async *fetch(): AsyncGenerator<CorpusItem> {
    const res = await globalThis.fetch(README_URL, { headers: { accept: 'text/plain' } });
    if (!res.ok) throw new Error(`every-programmer-should-know fetch failed: ${res.status}`);
    const md = await res.text();
    for (const item of parseEveryProgrammerShouldKnow(md)) yield item;
  },
};

/** Exported for tests. */
export function parseEveryProgrammerShouldKnow(md: string): CorpusItem[] {
  const out: CorpusItem[] = [];
  const seen = new Set<string>();
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('- ') && !line.startsWith('* ')) continue;
    const stripped = stripBulletAndLinks(line);
    if (!stripped) continue;
    if (stripped.length < 20 || stripped.length > 500) continue;
    if (!stripped.endsWith('?') && !STARTERS.test(stripped)) continue;
    const body = stripped.endsWith('?') || stripped.endsWith('.') ? stripped : `${stripped}?`;
    const key = body.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceId: 'every-programmer-should-know',
      sourceUrl: 'https://github.com/mtdvio/every-programmer-should-know',
      license: 'CC0-1.0',
      title: body.slice(0, 120),
      body,
      promptHash: hashPrompt(body),
    });
  }
  return out;
}

function stripBulletAndLinks(line: string): string {
  let s = line.replace(/^[-*]\s+/, '');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/\*\*|__/g, '').replace(/\*|_/g, '');
  s = s.replace(/`/g, '');
  return s.trim();
}
