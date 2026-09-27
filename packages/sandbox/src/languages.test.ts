import { describe, expect, it } from 'vitest';
import { LANGUAGES, getLanguageConfig } from './languages';
import type { LanguageId } from './types';

describe('language config registry', () => {
  it('exposes exactly the four supported languages', () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual(['go', 'node', 'python', 'typescript']);
  });

  it('every language config has non-empty image, cmd, entrypoint, workdir', () => {
    for (const [id, cfg] of Object.entries(LANGUAGES)) {
      expect(cfg.id, `id for ${id}`).toBe(id);
      expect(cfg.image.length, `image for ${id}`).toBeGreaterThan(0);
      expect(cfg.cmd.length, `cmd for ${id}`).toBeGreaterThan(0);
      expect(cfg.entrypoint.length, `entrypoint for ${id}`).toBeGreaterThan(0);
      expect(cfg.workdir.startsWith('/'), `workdir absolute for ${id}`).toBe(true);
    }
  });

  it('uses alpine (small, no shell tricks) for every image', () => {
    for (const cfg of Object.values(LANGUAGES)) {
      expect(cfg.image, `image ${cfg.image}`).toMatch(/alpine/);
    }
  });

  it('getLanguageConfig returns the same reference and throws on unknown', () => {
    expect(getLanguageConfig('node')).toBe(LANGUAGES.node);
    expect(() => getLanguageConfig('rust' as LanguageId)).toThrow(/unknown sandbox language/);
  });
});
