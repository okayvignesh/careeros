import { defineConfig } from 'vitest/config';

export default defineConfig({
  // apps/web (and packages/ui) ship `jsx: preserve` for Next, which Vite 8's
  // transform would otherwise pass through untouched — so a node vitest test
  // cannot import a JSX .tsx component (see UnavailableNotice/CodeEditor's
  // createElement workaround). Transform JSX with the automatic runtime so
  // component render tests (e.g. market-demand/Sparkline.test.ts) work without
  // adding jsdom / @testing-library or a React vite plugin.
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/e2e/**', '**/._*'],
    setupFiles: ['./vitest.setup.ts'],
    watch: false,
    testTimeout: 15_000,
  },
});
