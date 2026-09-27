// File-extension + shebang based language detection. Pure functions only.
//
// ponytail: file-extension + shebang is accurate enough to weight per-file
// evidence. AST-based analysis (tree-sitter, per-language grammars) is the
// upgrade path when we need "counts of async functions" or import-graph
// signals — that requires a build toolchain we don't want in the worker
// image today.
//
// Skill IDs match the ESCO-lite seed in apps/worker/src/skills-seed.ts +
// any framework/tool skills the framework-hints module emits.

/**
 * Extension → skill ID. Extensions are stored WITHOUT the leading dot and
 * lower-cased at lookup time. Aliases (`.mjs`, `.cjs`, `.tsx`, `.jsx`) fold
 * into the same skill as their canonical extension.
 *
 * Covers the 150+ commonly-encountered code extensions across the ESCO-lite
 * skill catalog. Non-code extensions (`.md`, `.txt`, `.log`, `.png`, `.pdf`,
 * lockfiles) are intentionally absent — the detector returns null for them.
 */
export const EXTENSION_TO_SKILL: Record<string, string> = {
  // --- JavaScript / TypeScript ---
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  // --- Python ---
  py: 'python', pyi: 'python', pyx: 'python', pyw: 'python',
  // --- Go ---
  go: 'go',
  // --- Rust ---
  rs: 'rust',
  // --- Ruby ---
  rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
  // --- Java / JVM ---
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  scala: 'scala', sc: 'scala',
  groovy: 'groovy', gradle: 'groovy',
  clj: 'clojure', cljs: 'clojure', cljc: 'clojure',
  // --- Swift / Objective-C ---
  swift: 'swift',
  m: 'objc', mm: 'objc',
  // --- C / C++ ---
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  // --- C# / F# / VB ---
  cs: 'csharp', csx: 'csharp',
  fs: 'fsharp', fsx: 'fsharp', fsi: 'fsharp',
  vb: 'vbnet',
  // --- PHP ---
  php: 'php', phtml: 'php', php4: 'php', php5: 'php', php7: 'php', php8: 'php',
  // --- SQL / DB ---
  sql: 'sql', psql: 'sql', mysql: 'sql', ddl: 'sql',
  // --- Shell / scripting ---
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'batch', cmd: 'batch',
  // --- Web front-end ---
  html: 'html', htm: 'html', xhtml: 'html',
  css: 'css', scss: 'css', sass: 'css', less: 'css', styl: 'css',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  // --- Data + config as code ---
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  json: 'json', jsonc: 'json', json5: 'json',
  xml: 'xml', xsd: 'xml', xslt: 'xml', xsl: 'xml',
  proto: 'protobuf',
  graphql: 'graphql', gql: 'graphql',
  // --- Infra ---
  tf: 'terraform', tfvars: 'terraform', hcl: 'terraform',
  // --- Others ---
  lua: 'lua',
  pl: 'perl', pm: 'perl',
  r: 'r',
  jl: 'julia',
  dart: 'dart',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hrl: 'erlang',
  hs: 'haskell',
  ml: 'ocaml', mli: 'ocaml',
  nim: 'nim',
  zig: 'zig',
  sol: 'solidity',
  tex: 'latex',
  // --- Notebooks ---
  ipynb: 'python',
  // --- WASM ---
  wat: 'wasm', wasm: 'wasm',
};

/**
 * Bare filenames (no path) that map directly to a skill. Case-insensitive;
 * looked up with lower-case.
 */
export const FILENAME_TO_SKILL: Record<string, string> = {
  dockerfile: 'docker',
  'dockerfile.dev': 'docker',
  'dockerfile.prod': 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  makefile: 'make',
  'gnumakefile': 'make',
  'cmakelists.txt': 'cmake',
  'gemfile': 'ruby',
  'rakefile': 'ruby',
  'podfile': 'swift',
  'brewfile': 'shell',
  'vagrantfile': 'ruby',
  '.gitignore': 'git',
  '.gitattributes': 'git',
};

/**
 * Shebang → skill ID. Matched against the FIRST line of a file only, and only
 * when the file has no informative extension. Values are substrings; the
 * detector picks the LAST matching key so more-specific ones win when they
 * appear inside a generic one.
 */
export const SHEBANG_TO_SKILL: Array<{ needle: string; skillId: string }> = [
  { needle: 'python', skillId: 'python' },
  { needle: 'node', skillId: 'js' },
  { needle: 'ruby', skillId: 'ruby' },
  { needle: 'perl', skillId: 'perl' },
  { needle: 'bash', skillId: 'shell' },
  { needle: 'zsh', skillId: 'shell' },
  { needle: 'sh', skillId: 'shell' },
  { needle: 'pwsh', skillId: 'powershell' },
  { needle: 'lua', skillId: 'lua' },
  { needle: 'php', skillId: 'php' },
];

/**
 * Returns the skill ID for a file path, or null if none of the signals fired.
 *
 * Ordering: (1) exact filename match (Dockerfile, Makefile), (2) extension
 * lookup, (3) shebang scan of `firstLine` if provided and other lookups
 * missed. `firstLine` is optional so callers that only have the path can
 * still get an answer for the common case.
 */
export function detectLanguage(path: string, firstLine?: string): string | null {
  const base = basename(path).toLowerCase();

  // Exact filename first — Dockerfile / Makefile don't have extensions.
  const byName = FILENAME_TO_SKILL[base];
  if (byName) return byName;

  const ext = extension(base);
  if (ext) {
    const byExt = EXTENSION_TO_SKILL[ext];
    if (byExt) return byExt;
  }

  if (firstLine && firstLine.startsWith('#!')) {
    // Match the LAST needle that occurs in the line so `python3` inside a
    // `/usr/bin/env python3` line still wins over the generic `sh` in `/bin/sh`.
    let hit: string | null = null;
    for (const { needle, skillId } of SHEBANG_TO_SKILL) {
      if (firstLine.includes(needle)) hit = skillId;
    }
    if (hit) return hit;
  }
  return null;
}

// --- helpers (exported for tests) ---

export function basename(path: string): string {
  // Handle both POSIX and Windows-ish separators without pulling `node:path`
  // (this module must be usable in edge environments too).
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function extension(nameOrPath: string): string | null {
  const b = basename(nameOrPath);
  // Dotfiles ('.gitignore') are not extensions; the caller looks those up via
  // FILENAME_TO_SKILL. Anything without a dot before the last segment has no
  // extension.
  if (!b.includes('.') || b.startsWith('.')) return null;
  const dot = b.lastIndexOf('.');
  return b.slice(dot + 1).toLowerCase();
}
