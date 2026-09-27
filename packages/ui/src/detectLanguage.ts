// Cheap language auto-detect. Peeks the first ~500 chars, matches on a small
// set of signals, falls back to typescript. Called once at editor mount (or
// when a task supplies raw code without language metadata).
//
// ponytail: regex heuristics, not a real parser. Upgrade to hljs auto-detect
// only if fixture accuracy drops below ~90% on mixed corpora.

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'sql'
  | 'json';

const DEFAULT_LANGUAGE: SupportedLanguage = 'typescript';
const PEEK = 500;

export function detectLanguage(source: string): SupportedLanguage {
  if (typeof source !== 'string' || source.length === 0) return DEFAULT_LANGUAGE;
  const head = source.slice(0, PEEK);
  const trimmed = head.trim();

  // JSON: strict — must parse as a top-level object or array.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(source);
      return 'json';
    } catch {
      // not JSON, keep going.
    }
  }

  // Go: package + import ( or func with typed receiver / return.
  if (/^\s*package\s+\w+/m.test(head) && /^\s*(import\s*\(|func\s+\w)/m.test(head)) {
    return 'go';
  }
  if (/^\s*func\s+\w+\s*\([^)]*\)\s*(\w|\()/m.test(head) && /:=|fmt\.|package\s+/.test(head)) {
    return 'go';
  }

  // Python: def / class with colon, or shebang, or common imports.
  if (/^\s*#!.*python/i.test(head)) return 'python';
  if (/^\s*(def|class)\s+\w+.*:/m.test(head)) return 'python';
  if (/^\s*(from\s+\w[\w.]*\s+import|import\s+\w[\w.]*)\s*(#|$)/m.test(head)) return 'python';

  // SQL: SELECT / INSERT / UPDATE / DELETE / CREATE at line start, case-insensitive.
  if (/^\s*(select|insert\s+into|update\s+\w|delete\s+from|create\s+(table|index|view))\b/im.test(head)) {
    return 'sql';
  }

  // TypeScript: `import type`, `: Type`, generics, `interface`, `as Foo`.
  if (/^\s*import\s+type\s/m.test(head)) return 'typescript';
  if (/^\s*(interface|type)\s+\w+\s*[=<{]/m.test(head)) return 'typescript';
  if (/:\s*(string|number|boolean|void|any|unknown|never|Promise<)/.test(head)) return 'typescript';

  // JavaScript: import/require/const/=>/function without TS annotations.
  if (/^\s*(import\s+[\w{*,\s}]+from|const\s+\w+\s*=|function\s+\w+\s*\(|module\.exports)/m.test(head)) {
    return 'javascript';
  }

  return DEFAULT_LANGUAGE;
}
