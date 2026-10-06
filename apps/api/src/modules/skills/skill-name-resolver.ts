// Pure name → catalogue-skill resolution. Shared by resume commit (bind a
// resume `skill` fact to an ESCO Skill id) and job skill extraction (accept an
// LLM that returned a catalogue *name* instead of an id).
//
// The catalogue is small (~200 rows), so callers pass it in and we rank
// in-memory. Never invent an id: unresolved terms return null so the caller can
// skip them, keeping AGENTS.md §3.1 (evidence, not claims) intact.

export interface CatalogueEntry {
  id: string;
  name: string;
  /** Alternate labels seeded on the Skill row. Optional so callers can load id+name only. */
  aliases?: readonly string[];
}

/**
 * Lowercase, fold punctuation to spaces, collapse whitespace. `+` and `#` are
 * kept so "C++"/"C#"/".NET" survive; everything else (dots, slashes, dashes,
 * commas) becomes a separator. "React.js" → "react js", "C++" → "c++".
 */
export function normalizeSkillName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(' ');
}

/** Every token in `a` also appears in `b`. Single-char tokens are rejected so
 *  "C" never swallows the whole catalogue. */
function tokenSubset(a: readonly string[], b: readonly string[]): boolean {
  if (a.some((t) => t.length < 2)) return false;
  const set = new Set(b);
  return a.every((t) => set.has(t));
}

/**
 * Resolve a free-form term to a catalogue id. Preference order:
 *   1. exact id (case-insensitive, raw — ids are slugs like "ts")
 *   2. punctuation/case-normalized exact match on name or alias
 *   3. cautious token match (one is a token-subset of the other) — only when
 *      exactly ONE catalogue row matches, so "js" can't collapse to a guess.
 * Returns null when unresolved.
 */
export function resolveSkillId(
  term: string,
  catalogue: readonly CatalogueEntry[],
): string | null {
  const raw = term.trim();
  if (!raw) return null;
  const needle = normalizeSkillName(raw);

  for (const s of catalogue) {
    if (s.id.toLowerCase() === raw.toLowerCase()) return s.id;
  }
  for (const s of catalogue) {
    if (normalizeSkillName(s.name) === needle) return s.id;
  }
  for (const s of catalogue) {
    if ((s.aliases ?? []).some((a) => normalizeSkillName(a) === needle)) return s.id;
  }

  const needleTokens = tokens(needle);
  if (needleTokens.length === 0) return null;
  const matches = new Set<string>();
  for (const s of catalogue) {
    const candidates = [normalizeSkillName(s.name), ...(s.aliases ?? []).map(normalizeSkillName)];
    for (const cand of candidates) {
      const candTokens = tokens(cand);
      if (candTokens.length === 0) continue;
      if (tokenSubset(needleTokens, candTokens) || tokenSubset(candTokens, needleTokens)) {
        matches.add(s.id);
        break;
      }
    }
  }
  return matches.size === 1 ? ([...matches][0] as string) : null;
}

/**
 * Map a list of LLM-returned values to catalogue ids. Each value may already be
 * an id or a catalogue name/alias; unresolved values are dropped. Output is
 * de-duplicated and order-preserving.
 */
export function resolveSkillNamesToIds(
  values: readonly string[],
  catalogue: readonly CatalogueEntry[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const id = resolveSkillId(v, catalogue);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
