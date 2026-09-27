import type { LanguageConfig } from '../types';

export const python: LanguageConfig = {
  id: 'python',
  image: 'python:3.12-alpine',
  extension: 'py',
  entrypoint: 'main.py',
  workdir: '/sandbox',
  cmd: ['python', '/sandbox/main.py'],
};
