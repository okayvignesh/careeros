// Root ESLint config. Dormant until a workspace adds `eslint` + opts into
// this chain via its own `.eslintrc` (`"extends": ["../../.eslintrc.cjs"]`).
// Lives here so three cross-cutting rules have ONE home instead of being
// duplicated per package:
//
//   1. no-console in production code (observability.md)
//   2. no raw `provider.chat(` outside UI/provider boundaries (ai-safety.md item 2)
//   3. no auto-generated / interpolated `data-testid` on React elements (testing.md item 3 rule 3)
//
// ponytail: `apps/web` + `packages/ui` are owned by session-design-revamp
// and ship their own `next lint` / local eslint. These rules activate for
// them when they add `extends: ["../../.eslintrc.cjs"]`. Until then this
// file is a reference the design session can adopt without a merge.
//
// Not installed as a devDep. Any session that wants real lint runs
// `pnpm add -Dw eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin`
// at the point they need it. Writing a config without the runner is cheap;
// adding deps nobody runs is the bloat we avoid.

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  env: { node: true, es2022: true, browser: true },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '.next/',
    'coverage/',
    '*.generated.*',
    'prisma/generated/',
    'packages/*/dist/',
  ],
  rules: {
    // Rule 1 (observability.md): no console.log in prod code; warn/error allowed
    // because they map to pino logger levels and operators grep for them.
    // Overrides below carve out tests, demos, seeds, scripts.
    'no-console': ['error', { allow: ['warn', 'error'] }],

    // Rule 2 (ai-safety.md item 2): raw `.chat(` must go through chatStructured
    // (schema-validated) OR live inside packages/ai (the provider itself).
    // Overrides below carve out those two homes.
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.property.name='chat']",
        message:
          'Raw provider.chat() is forbidden outside packages/ai. Use provider.chatStructured() with a Zod schema so outputs are validated. See plan/ai-safety.md item 2.',
      },
      // Rule 3 (testing.md item 3 rule 3): data-testid must be a string literal.
      // Blocks template literals, variables, UUIDs, and expressions — they
      // break Playwright selectors across renders. Only `data-testid="literal"`
      // is allowed.
      {
        selector:
          "JSXAttribute[name.name='data-testid'] > JSXExpressionContainer",
        message:
          'data-testid must be a string literal, not an expression. Interpolated / generated test ids break Playwright and visual-regression selectors. See plan/testing.md item 3 rule 3.',
      },
    ],
  },
  overrides: [
    // Allow console in: tests, demos, seed scripts, ops scripts, loggers.
    {
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.demo.ts',
        '**/__tests__/**',
        '**/__fixtures__/**',
        'scripts/**',
        'apps/api/src/seed/**',
        'packages/*/src/**/*logger*',
      ],
      rules: {
        'no-console': 'off',
      },
    },
    // Allow raw `.chat(` in: packages/ai (provider lives there) and in
    // tests/mocks that need to stub both call-shapes.
    {
      files: [
        'packages/ai/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/__tests__/**',
      ],
      rules: {
        'no-restricted-syntax': 'off',
      },
    },
  ],
};
