/**
 * Selector-health probe. Given a DOM snapshot (plain HTML string) and the
 * expected selectors from an allowlist entry, reports which are missing and
 * which drifted.
 *
 * "Missing" = selector matches nothing.
 * "Drifted" = selector matches but its immediate structure looks off (child
 * count outside the recorded baseline). The baseline is optional; without
 * it, drift detection is skipped and only missing is reported.
 *
 * Pure function — no DOM APIs; uses a tiny regex+bracket scan since we run
 * this in Node (agent-side) before we hand off to Playwright. Good enough to
 * catch "the page changed shape overnight", not a full CSS engine.
 *
 * ponytail: regex heuristic, upgrade to a real parser (`node-html-parser`)
 * if we ever start missing legitimate drift because of nested-quote weirdness.
 */

export interface SelectorBaseline {
  /** Recorded child-count of the matched element on the golden snapshot. */
  childCount: number;
}

export interface SelectorHealth {
  healthy: boolean;
  missing: string[];
  drifted: string[];
}

export interface CheckOptions {
  /** Optional per-selector baselines; drift only checked if provided. */
  baselines?: Record<string, SelectorBaseline>;
}

export function checkSelectorHealth(
  domSnapshot: string,
  selectors: readonly string[],
  opts: CheckOptions = {},
): SelectorHealth {
  const missing: string[] = [];
  const drifted: string[] = [];
  for (const sel of selectors) {
    const match = findFirstMatch(domSnapshot, sel);
    if (!match) {
      missing.push(sel);
      continue;
    }
    const baseline = opts.baselines?.[sel];
    if (baseline && Math.abs(match.childCount - baseline.childCount) > 1) {
      drifted.push(sel);
    }
  }
  return { healthy: missing.length === 0 && drifted.length === 0, missing, drifted };
}

interface Match {
  childCount: number;
}

/**
 * Ultra-small selector matcher. Supports:
 *   - `tag` (e.g. `button`)
 *   - `#id`
 *   - `.class`
 *   - `tag[attr=value]` / `tag[attr*=value]`
 * Combinations of the above without whitespace.
 * Descendant combinators are NOT supported; allowlist selectors used here
 * are single-hop targets from PLAN.md, so we don't need them.
 */
function findFirstMatch(html: string, selector: string): Match | null {
  const parsed = parseSelector(selector);
  if (!parsed) return null;

  const tagPattern = parsed.tag ?? '[a-z][a-z0-9-]*';
  const re = new RegExp(`<(${tagPattern})\\b([^>]*)>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[2] ?? '';
    if (!matchesAttrs(attrs, parsed)) continue;
    return { childCount: countDirectChildren(html, re.lastIndex, m[1]!) };
  }
  return null;
}

interface ParsedSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: Array<{ name: string; op: '=' | '*=' | null; value: string | null }>;
}

function parseSelector(selector: string): ParsedSelector | null {
  const s = selector.trim();
  if (!s) return null;
  const out: ParsedSelector = { tag: null, id: null, classes: [], attrs: [] };
  const tagMatch = /^([a-z][a-z0-9-]*)/i.exec(s);
  let i = 0;
  if (tagMatch) {
    out.tag = tagMatch[1]!.toLowerCase();
    i = tagMatch[0].length;
  }
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '#') {
      const m = /^#([\w-]+)/.exec(s.slice(i));
      if (!m) return null;
      out.id = m[1]!;
      i += m[0].length;
    } else if (ch === '.') {
      const m = /^\.([\w-]+)/.exec(s.slice(i));
      if (!m) return null;
      out.classes.push(m[1]!);
      i += m[0].length;
    } else if (ch === '[') {
      // Supports attr-only (`[hidden]`), `=`, `*=`, `~=`, `|=`. The attribute
      // head is parsed with an anchored, unambiguous regex; the value is then
      // read with `indexOf` so a quoted value may itself contain `]`. The old
      // form used nested unbounded classes around `\]` and tripped
      // js/polynomial-redos; this scan is linear.
      const rest = s.slice(i);
      const head = /^\[([\w-]+)(\*?=|~=|\|=)?/.exec(rest);
      if (!head) return null;
      const name = head[1]!.toLowerCase();
      const rawOp = head[2];
      const op = rawOp === '*=' ? '*=' : rawOp === '=' ? '=' : null;
      let value: string | null = null;
      let end: number;
      if (rest[head[0].length] === '"') {
        const closeQuote = rest.indexOf('"', head[0].length + 1);
        if (closeQuote === -1 || rest[closeQuote + 1] !== ']') return null;
        value = rest.slice(head[0].length + 1, closeQuote);
        end = closeQuote + 2;
      } else {
        const close = rest.indexOf(']', head[0].length);
        if (close === -1) return null;
        const bare = rest.slice(head[0].length, close);
        // A bare value may not contain a quote (matches the prior `[^\]"]*`).
        if (bare.includes('"')) return null;
        value = bare;
        end = close + 1;
      }
      out.attrs.push({ name, op, value: op ? value : null });
      i += end;
    } else {
      return null;
    }
  }
  return out;
}

function matchesAttrs(attrs: string, parsed: ParsedSelector): boolean {
  const attrMap = parseAttrString(attrs);
  if (parsed.id && attrMap.id !== parsed.id) return false;
  if (parsed.classes.length) {
    const cls = (attrMap.class ?? '').split(/\s+/);
    for (const c of parsed.classes) {
      if (!cls.includes(c)) return false;
    }
  }
  for (const a of parsed.attrs) {
    const v = attrMap[a.name];
    if (v === undefined) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '*=' && !v.includes(a.value ?? '')) return false;
  }
  return true;
}

function parseAttrString(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out[m[1]!.toLowerCase()] = m[2]!;
  }
  return out;
}

function countDirectChildren(html: string, startIdx: number, tag: string): number {
  // Scan forward from `startIdx`, tracking depth 1 (we're already inside the opener).
  // Count opening tags at depth 1 as direct children. Stop when we close depth 0.
  const closeTag = `</${tag.toLowerCase()}>`;
  const openRe = /<([a-z][a-z0-9-]*)\b[^>]*>|<\/([a-z][a-z0-9-]*)>/gi;
  openRe.lastIndex = startIdx;
  let depth = 1;
  let children = 0;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    const opener = m[1];
    const closer = m[2];
    if (opener) {
      if (isVoidElement(opener)) {
        if (depth === 1) children++;
      } else {
        if (depth === 1) children++;
        depth++;
      }
    } else if (closer) {
      depth--;
      if (depth === 0) return children;
      // ponytail: this exists; a malformed snapshot with orphan close tags
      // will under-count children by exactly one — the drift check tolerates
      // +/- 1, so we don't get spurious "drift" from that.
      if (m[0].toLowerCase() === closeTag && depth < 0) return children;
    }
  }
  return children;
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'source', 'track', 'wbr',
]);

function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.has(tag.toLowerCase());
}
