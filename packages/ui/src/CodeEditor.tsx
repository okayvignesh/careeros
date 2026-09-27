'use client';

// Monaco-backed code editor for the P2 assessment arena.
//
// Loading:
// - Uses `next/dynamic` with `ssr: false` so the Monaco bundle never lands in
//   the server chunk. First mount fetches @monaco-editor/react + monaco-editor
//   from Next's client chunk cache.
// - A tiny placeholder renders during hydration so the height is stable and
//   layout does not jump.
//
// Theming:
// - Two named themes, `careeros-dark` and `careeros-light`, defined once on
//   first mount from the tokens.css HSL vars. Defaults to dark; the caller
//   can pass `theme` to force one. If the caller does not pass a theme we
//   peek at `<html class="light">` to derive it (matches how tokens.css
//   scopes the light palette).
//
// This file uses React.createElement instead of JSX because the packages/ui
// tsconfig ships `jsx: preserve` (for the Next consumer), and the vitest
// pipeline that pulls this file into a jsdom render test does not want a
// preserve-mode .tsx. ponytail: no JSX here so the same file compiles under
// both toolchains without a per-package vitest override.

import dynamic from 'next/dynamic';
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import type { OnChange, OnMount } from '@monaco-editor/react';

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then((m) => m.default),
  { ssr: false, loading: () => renderSkeleton() },
);

export type CodeEditorLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'sql'
  | 'json';

export type CodeEditorTheme = 'dark' | 'light';

export interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  language?: CodeEditorLanguage;
  readOnly?: boolean;
  height?: number | string;
  theme?: CodeEditorTheme;
  className?: string;
}

function inferTheme(): CodeEditorTheme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function readVar(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  return 'hsl(' + raw + ')';
}

// Monaco theme colors must be `#rrggbb`, not `hsl(...)`. Convert once.
function hslToHex(hslStr: string): string {
  const m = /hsl\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*\)/.exec(hslStr);
  if (!m) return '#0b0d14';
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v: number): string => Math.round((v + mm) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

function renderSkeleton(): JSX.Element {
  return createElement('div', {
    'aria-hidden': true,
    className:
      'w-full rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]',
    style: { height: '100%', minHeight: 200 },
  });
}

export function CodeEditor(props: CodeEditorProps): JSX.Element {
  const {
    value,
    onChange,
    language = 'typescript',
    readOnly = false,
    height = '400px',
    theme,
    className,
  } = props;

  const [resolvedTheme, setResolvedTheme] = useState<CodeEditorTheme>(theme ?? 'dark');

  useEffect(() => {
    if (theme) {
      setResolvedTheme(theme);
      return;
    }
    setResolvedTheme(inferTheme());
  }, [theme]);

  const handleChange: OnChange = useCallback(
    (v) => {
      onChange(v ?? '');
    },
    [onChange],
  );

  const handleMount: OnMount = useCallback((_editor, monaco) => {
    monaco.editor.defineTheme('careeros-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': hslToHex(readVar('--bg-elev-1', 'hsl(235 18% 6.5%)')),
        'editor.foreground': hslToHex(readVar('--fg', 'hsl(235 20% 97%)')),
        'editorLineNumber.foreground': hslToHex(readVar('--fg-faint', 'hsl(235 8% 30%)')),
        'editor.selectionBackground': hslToHex(readVar('--accent-muted', 'hsl(239 40% 26%)')),
        'editorCursor.foreground': hslToHex(readVar('--accent', 'hsl(239 84% 66%)')),
      },
    });
    monaco.editor.defineTheme('careeros-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': hslToHex(readVar('--bg-elev-1', 'hsl(0 0% 100%)')),
        'editor.foreground': hslToHex(readVar('--fg', 'hsl(235 30% 8%)')),
        'editorLineNumber.foreground': hslToHex(readVar('--fg-faint', 'hsl(235 12% 68%)')),
        'editor.selectionBackground': hslToHex(readVar('--accent-muted', 'hsl(239 40% 86%)')),
        'editorCursor.foreground': hslToHex(readVar('--accent', 'hsl(239 84% 66%)')),
      },
    });
  }, []);

  const monacoTheme = resolvedTheme === 'light' ? 'careeros-light' : 'careeros-dark';

  const options = useMemo(
    () => ({
      readOnly,
      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 2,
      automaticLayout: true,
      renderLineHighlight: 'line' as const,
      padding: { top: 12, bottom: 12 },
    }),
    [readOnly],
  );

  return createElement(
    'div',
    {
      className:
        'overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] ' +
        (className ?? ''),
      style: { height },
      'data-testid': 'careeros-code-editor',
    },
    createElement(MonacoEditor, {
      height: '100%',
      value,
      onChange: handleChange,
      onMount: handleMount,
      language,
      theme: monacoTheme,
      options,
      loading: renderSkeleton(),
    }),
  );
}
