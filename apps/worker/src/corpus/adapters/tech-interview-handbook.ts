import type { CorpusAdapter, CorpusItem } from '../types';
import { hashPrompt } from '../hash';

/**
 * Adapter for yangshun/tech-interview-handbook (MIT).
 * LICENSE: https://github.com/yangshun/tech-interview-handbook/blob/main/LICENSE
 *
 * The handbook publishes best-practice interview questions across several
 * topical READMEs. We fetch the top-level questions index (`questions.md`)
 * and split it into one item per H3 heading — the file's canonical shape is
 * `### Question\n\nOptional prose...`.
 *
 * ponytail: single README, one parse pass. When the handbook grows a second
 * on-topic file worth ingesting, promote the URL list to an array and keep
 * the same parser.
 */

const README_URL =
  'https://raw.githubusercontent.com/yangshun/tech-interview-handbook/main/contents/en/questions-to-ask.md';

export const techInterviewHandbookAdapter: CorpusAdapter = {
  id: 'tech-interview-handbook',
  name: 'Tech Interview Handbook',
  license: 'MIT',
  sourceUrl: 'https://github.com/yangshun/tech-interview-handbook',
  async *fetch(): AsyncGenerator<CorpusItem> {
    const res = await globalThis.fetch(README_URL, { headers: { accept: 'text/plain' } });
    if (!res.ok) throw new Error(`tech-interview-handbook fetch failed: ${res.status}`);
    const md = await res.text();
    for (const item of parseTechInterviewHandbook(md)) yield item;
  },
};

/** Exported for tests. Same input the adapter feeds after fetching. */
export function parseTechInterviewHandbook(md: string): CorpusItem[] {
  const out: CorpusItem[] = [];
  const seen = new Set<string>();
  const lines = md.split('\n');
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (!currentHeading) return;
    const title = currentHeading.trim();
    // Body is heading + first prose paragraph — the answer/context. Bullets
    // that follow the heading are the interview-worthy detail.
    const body = [title, ...currentBody.map((l) => l.trim()).filter(Boolean)]
      .join('\n')
      .trim();
    if (body.length < 20 || body.length > 4000) return;
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      sourceId: 'tech-interview-handbook',
      sourceUrl: 'https://github.com/yangshun/tech-interview-handbook',
      license: 'MIT',
      title,
      body,
      promptHash: hashPrompt(body),
    });
  };

  for (const raw of lines) {
    // H3 delimits one question. H1/H2 are section headers — skip.
    if (raw.startsWith('### ')) {
      flush();
      currentHeading = stripMarkdown(raw.slice(4));
      currentBody = [];
      continue;
    }
    // Reset on higher-level headings so cross-section prose doesn't bleed in.
    if (raw.startsWith('# ') || raw.startsWith('## ')) {
      flush();
      currentHeading = null;
      currentBody = [];
      continue;
    }
    if (currentHeading) currentBody.push(raw);
  }
  flush();
  return out;
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .trim();
}
