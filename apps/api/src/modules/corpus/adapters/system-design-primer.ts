import type { CorpusAdapter, IngestedQuestion } from '../types';

/**
 * Adapter for donnemartin/system-design-primer (MIT + Creative Commons).
 *
 * The primer's README has a long "Study guide" that includes an inline list
 * of practice interview questions. We fetch the raw README and extract every
 * bullet line whose visible text ends with "?" as a candidate question. Skill
 * defaults to `system-design` since that's the entire scope of the source.
 *
 * ponytail: the parser is intentionally forgiving — it walks each line once,
 * strips markdown link decoration, and skips anything that doesn't smell like
 * a question. If the source layout shifts and 0 questions come out, the sync
 * returns cleanly (no throw) so operators can notice and file an adapter fix
 * without an outage.
 */

const README_URL =
  'https://raw.githubusercontent.com/donnemartin/system-design-primer/master/README.md';

export const systemDesignPrimerAdapter: CorpusAdapter = {
  id: 'system-design-primer',
  name: 'System Design Primer',
  licenseSpdx: 'CC-BY-4.0',
  sourceUrl: 'https://github.com/donnemartin/system-design-primer',
  attribution:
    'From the System Design Primer by Donne Martin (CC BY 4.0). https://github.com/donnemartin/system-design-primer',
  async fetch(): Promise<IngestedQuestion[]> {
    const res = await globalThis.fetch(README_URL, {
      headers: { accept: 'text/plain' },
    });
    if (!res.ok) throw new Error(`system-design-primer fetch failed: ${res.status}`);
    const md = await res.text();
    return parseSystemDesignPrimer(md);
  },
};

/**
 * Question heuristic: a bullet line is a question if it EITHER ends with `?`
 * OR starts with one of the imperative/interrogative starter words the primer
 * actually uses in its practice-questions list (`- [Design X](exercise)` etc).
 * The primer omits `?` on link-form bullets, so a strict `?`-only rule would
 * yield ~0 questions from the real README. Starters cover the common shapes
 * across other permissive question banks too.
 */
const STARTERS = /^(design|implement|build|create|write|how\b|what\b|why\b|when\b|where\b|explain|describe)/i;

/** Exported for tests — same input the adapter feeds after fetching. */
export function parseSystemDesignPrimer(md: string): IngestedQuestion[] {
  const out: IngestedQuestion[] = [];
  const seen = new Set<string>();
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('- ') && !line.startsWith('* ')) continue;
    const stripped = stripBulletAndLinks(line);
    if (!stripped) continue;
    if (stripped.length < 20 || stripped.length > 500) continue;
    const looksLikeQuestion = stripped.endsWith('?') || STARTERS.test(stripped);
    if (!looksLikeQuestion) continue;
    // Normalise: ensure trailing `?` so the grader / display treats it uniformly.
    const prompt = stripped.endsWith('?') || stripped.endsWith('.')
      ? stripped
      : `${stripped}?`;
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      prompt,
      skillIds: ['system-design'],
      difficulty: 'medium',
      answerHint: null,
    });
  }
  return out;
}

function stripBulletAndLinks(line: string): string {
  // Remove leading bullet marker.
  let s = line.replace(/^[-*]\s+/, '');
  // Markdown link: [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Bold/italic markers.
  s = s.replace(/\*\*|__/g, '').replace(/\*|_/g, '');
  // Inline code backticks.
  s = s.replace(/`/g, '');
  return s.trim();
}
