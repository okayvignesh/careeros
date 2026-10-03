// ESLint flat config for the Next.js app.
//
// Next 16 removed the `next lint` command, so `pnpm lint` runs the ESLint CLI
// directly. `eslint-config-next@16` ships native flat configs; the two imports
// below reproduce the `next/core-web-vitals` + `next/typescript` stack that
// `next lint` used to apply.
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  // Default ignores from eslint-config-next, kept explicit so generated
  // Next artefacts never get linted. `**/._*` skips macOS AppleDouble
  // metadata sidecar files (created when editing on non-native volumes).
  { ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts', '**/._*'] },
  {
    rules: {
      // Panels fetch through `@/lib/use-api`, whose effect commits state only
      // from promise callbacks. Keep the rule strict so a synchronous
      // setState-in-effect can't sneak back in.
      'react-hooks/set-state-in-effect': 'error',
    },
  },
];

export default config;
