import type { LanguageConfig } from '../types';

// ponytail: node:20-alpine + built-in `--experimental-strip-types` runs plain .ts
// without ts-node or a compile step. Alpine node 20 supports it; if that stripping
// isn't enough (decorators, tsx, path aliases), bake a real ts-node image.
export const typescript: LanguageConfig = {
  id: 'typescript',
  image: 'node:20-alpine',
  extension: 'ts',
  entrypoint: 'main.ts',
  workdir: '/sandbox',
  cmd: ['node', '--experimental-strip-types', '--no-warnings', '/sandbox/main.ts'],
};
