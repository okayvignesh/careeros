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
      // `react-hooks/set-state-in-effect` flags the ubiquitous fetch-on-mount
      // pattern — `useEffect(() => { void load(); }, [load])` — because the
      // async loader ends up calling setState. That pattern is legitimate in
      // these panels, and the clean fix is to migrate them to a data-fetching
      // hook (SWR / React Query) or `use()`, which is follow-up work outside
      // this cleanup's scope. Keep it as a warning so genuinely synchronous
      // setState-in-effect calls are still surfaced.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

export default config;
