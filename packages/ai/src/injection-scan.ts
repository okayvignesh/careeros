// Injection-scan pass on untrusted content (job descriptions, README, emails,
// company pages, PDFs). Layered defence: `wrapUntrusted` already tags content
// as inert data, but adversaries still try the obvious "IGNORE PREVIOUS"
// pattern + more subtle unicode-tag payloads that the model would silently
// decode. This scanner catches the loud cases + logs them.
//
// Scope: fast regex + character-class checks. No LLM classifier here; that
// lives in `injection-scan.prompt.ts` for the borderline path (item 5, later).
//
// Blueprint AI-Safety Item 5.

export type Severity = 'clean' | 'suspect' | 'blocked';

export interface InjectionHit {
  kind: string;
  match: string;
  index: number;
}

export interface InjectionScanResult {
  hits: InjectionHit[];
  severity: Severity;
}

// Regex patterns for known prompt-injection markers. Case-insensitive, unicode.
// Kept explicit so the audit log entry names the exact rule that fired.
const PATTERN_RULES: Array<{ kind: string; re: RegExp; blocks: boolean }> = [
  { kind: 'ignore-previous', re: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?|context)/iu, blocks: true },
  { kind: 'disregard-previous', re: /disregard\s+(all\s+)?(previous|prior|above)/iu, blocks: true },
  { kind: 'you-are-now', re: /you\s+are\s+now\s+(a|an|the)\s+/iu, blocks: false },
  { kind: 'new-instructions', re: /new\s+(instructions?|system\s+prompt|rules?)\s*[:.]/iu, blocks: true },
  { kind: 'role-tag-system', re: /<\|?\s*(system|assistant|user)\s*\|?>/iu, blocks: true },
  { kind: 'role-header-system', re: /^\s*###\s*(system|assistant)\b/imu, blocks: true },
  { kind: 'role-prefix-system', re: /^\s*system\s*:\s*/imu, blocks: false },
  { kind: 'jailbreak-DAN', re: /\bDAN\b|do\s+anything\s+now/iu, blocks: false },
  { kind: 'developer-mode', re: /developer\s+mode|jailbreak/iu, blocks: false },
  { kind: 'override-instruction', re: /override\s+(the\s+)?(instructions?|prompt|system)/iu, blocks: true },
];

// U+E0000-U+E007F: Unicode Tag block. Historically used for language tags,
// now a common covert-channel payload for prompt injection.
const UNICODE_TAG_RE = /[\u{E0000}-\u{E007F}]/u;

// Zero-width characters. A cluster (3+) in short text is suspicious.
const ZERO_WIDTH_RE = /[​-‍⁠﻿]/gu;

// Homoglyphs of "system"/"assistant" using Cyrillic look-alikes (а, е, о, р, с).
// Only flags mixed-script tokens so we do not misfire on the real English words.
const HOMOGLYPH_SYSTEM_RE = /(?:s|ѕ|ѕ)(?:y|у|у)(?:s|ѕ|ѕ)(?:t|т|т)(?:e|е|е)(?:m|м|м)/iu;
const HOMOGLYPH_ASSISTANT_RE = /(?:a|а|а)(?:s|ѕ|ѕ)(?:s|ѕ|ѕ)(?:i|і|і)(?:s|ѕ|ѕ)(?:t|т|т)(?:a|а|а)(?:n|п|п)(?:t|т|т)/iu;

function hasNonLatin(word: string): boolean {
  // Anything outside the ASCII letter range fires this.
  return /[^\x00-\x7f]/.test(word);
}

/**
 * Scan a string for prompt-injection markers.
 *   `clean`   nothing matched
 *   `suspect` at least one non-blocking marker matched (log + wrap + continue)
 *   `blocked` at least one blocking marker matched (throw at wrapUntrusted)
 */
export function scanForInjection(text: string): InjectionScanResult {
  const hits: InjectionHit[] = [];
  let blocking = false;

  if (typeof text !== 'string' || text.length === 0) {
    return { hits, severity: 'clean' };
  }

  for (const rule of PATTERN_RULES) {
    const m = rule.re.exec(text);
    if (m) {
      hits.push({ kind: rule.kind, match: m[0].slice(0, 80), index: m.index });
      if (rule.blocks) blocking = true;
    }
  }

  const tagMatch = UNICODE_TAG_RE.exec(text);
  if (tagMatch) {
    hits.push({ kind: 'unicode-tag-block', match: '<tag-chars>', index: tagMatch.index });
    blocking = true;
  }

  // Zero-width: fire on any cluster of 3+ zero-width characters (single ZWJ
  // in emoji is legitimate; a cluster is not).
  const zw = text.match(ZERO_WIDTH_RE);
  if (zw && zw.length >= 3) {
    hits.push({ kind: 'zero-width-cluster', match: `${zw.length} chars`, index: 0 });
    // Suspect not blocked: benign use exists (BOM, font-rendering hints).
  }

  // Homoglyph "system"/"assistant" only when the matched token contains
  // non-ASCII characters (real English matches are ignored).
  const sysH = HOMOGLYPH_SYSTEM_RE.exec(text);
  if (sysH && hasNonLatin(sysH[0])) {
    hits.push({ kind: 'homoglyph-system', match: sysH[0], index: sysH.index });
    blocking = true;
  }
  const asstH = HOMOGLYPH_ASSISTANT_RE.exec(text);
  if (asstH && hasNonLatin(asstH[0])) {
    hits.push({ kind: 'homoglyph-assistant', match: asstH[0], index: asstH.index });
    blocking = true;
  }

  const severity: Severity = blocking ? 'blocked' : hits.length > 0 ? 'suspect' : 'clean';
  return { hits, severity };
}

// -- audit hook -------------------------------------------------------------

type InjectionAuditHook = (event: {
  code: string;
  kind: string;
  severity: Severity;
  hits: InjectionHit[];
}) => void;

let auditHook: InjectionAuditHook | null = null;

/** Register a callback for every suspect / blocked scan. Last writer wins. */
export function setInjectionAuditHook(hook: InjectionAuditHook | null): void {
  auditHook = hook;
}

function audit(kind: string, severity: Severity, hits: InjectionHit[]): void {
  const code =
    severity === 'blocked' ? 'security.audit.injection_blocked' : 'security.audit.injection_suspect';
  const evt = { code, kind, severity, hits };
  try {
    auditHook?.(evt);
  } catch {
    /* audit must never throw */
  }
  // ponytail: console.warn is the fallback until packages/* gain a shared pino
  // logger. Downstream pipes the code prefix into the api pino stream.
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify(evt));
}

/**
 * Explicit scan-and-audit entry point for callers that want to inspect a
 * string without invoking the wrap boundary. Returns the scan result and
 * side-effects the audit hook + console.warn on suspect/blocked. The real
 * throw+wrap path lives in `wrap.ts::wrapUntrusted`, which every ingest
 * caller uses; this helper exists for standalone scanners.
 */
export function auditScan(kind: string, text: string): InjectionScanResult {
  const scan = scanForInjection(text);
  if (scan.severity !== 'clean') audit(kind, scan.severity, scan.hits);
  return scan;
}
