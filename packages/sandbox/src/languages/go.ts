import type { LanguageConfig } from '../types';

// ponytail: `go run` compiles then executes. Fine for short snippets; if compile time
// dominates for long code, switch to a prebuilt-binary flow with a compile stage.
export const go: LanguageConfig = {
  id: 'go',
  image: 'golang:1.23-alpine',
  extension: 'go',
  entrypoint: 'main.go',
  workdir: '/sandbox',
  cmd: ['go', 'run', '/sandbox/main.go'],
};
