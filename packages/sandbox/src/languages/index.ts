import type { LanguageConfig, LanguageId } from '../types';
import { node } from './node';
import { python } from './python';
import { go } from './go';
import { typescript } from './typescript';

export const LANGUAGES: Record<LanguageId, LanguageConfig> = {
  node,
  python,
  go,
  typescript,
};

export function getLanguageConfig(id: LanguageId): LanguageConfig {
  const cfg = LANGUAGES[id];
  if (!cfg) throw new Error(`unknown sandbox language: ${id}`);
  return cfg;
}
