import type { LanguageConfig } from '../types';

// ponytail: node:20-alpine baked with nothing extra. --network none forbids `npm install`
// at runtime; bake deps into a custom image if a task ever needs them.
export const node: LanguageConfig = {
  id: 'node',
  image: 'node:20-alpine',
  extension: 'js',
  entrypoint: 'main.js',
  workdir: '/sandbox',
  cmd: ['node', '/sandbox/main.js'],
};
