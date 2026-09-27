// C-P1.4c: eval-only vitest config. Root vitest.config.ts globs `*.test.ts`
// only; eval fixtures live in `*.eval.ts` so they never accidentally run in
// the fast unit-test pass. `pnpm --filter @careeros/ai test:evals` targets
// this config; `.github/workflows/nightly-evals.yml` invokes that script.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export default defineConfig({
  test: {
    root: repoRoot,
    include: ['packages/ai/src/evals/**/*.eval.ts', 'packages/ai/src/evals/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: [resolve(repoRoot, 'vitest.setup.ts')],
    watch: false,
    testTimeout: 60_000,
  },
});
