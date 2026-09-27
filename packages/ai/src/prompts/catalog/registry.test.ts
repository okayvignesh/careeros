import { describe, expect, it } from 'vitest';
import { PromptRegistry, type Prompt } from './registry';

function makePrompt(over: Partial<Prompt> = {}): Prompt {
  return {
    id: 'sample',
    version: '1.0.0',
    template: 'system prose\n\nuser template with {{var}}',
    ...over,
  };
}

describe('PromptRegistry.register (C-P0.2)', () => {
  it('accepts a new prompt', () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt());
    expect(reg.list()).toHaveLength(1);
  });

  it('is idempotent on identical re-register (same id+version+template)', () => {
    const reg = new PromptRegistry();
    const p = makePrompt();
    reg.register(p);
    reg.register({ ...p }); // clone, identical content
    expect(reg.list()).toHaveLength(1);
  });

  it('throws when same id+version has different template content', () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ template: 'original' }));
    expect(() =>
      reg.register(makePrompt({ template: 'mutated' })),
    ).toThrow(/already registered with different content/);
  });

  it('accepts multiple versions of the same id', () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ version: '1.0.0' }));
    reg.register(makePrompt({ version: '1.0.1', template: 'v2' }));
    expect(reg.list()).toHaveLength(2);
  });

  it('rejects missing id / version / template', () => {
    const reg = new PromptRegistry();
    expect(() => reg.register(makePrompt({ id: '' }))).toThrow(/id required/);
    expect(() => reg.register(makePrompt({ version: '' }))).toThrow(/missing version/);
    expect(() => reg.register(makePrompt({ template: '' }))).toThrow(/missing template/);
  });
});

describe('PromptRegistry.resolve (C-P0.2)', () => {
  it('returns latest version when version omitted', () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ version: '1.0.0' }));
    reg.register(makePrompt({ version: '1.2.0', template: 'v2' }));
    reg.register(makePrompt({ version: '1.10.0', template: 'v3' })); // > 1.2.0 numerically
    expect(reg.resolve('sample').version).toBe('1.10.0');
  });

  it('returns specific version when requested', () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ version: '1.0.0' }));
    reg.register(makePrompt({ version: '2.0.0', template: 'v2' }));
    expect(reg.resolve('sample', '1.0.0').version).toBe('1.0.0');
    expect(reg.resolve('sample', '2.0.0').version).toBe('2.0.0');
  });

  it('throws on unknown id', () => {
    const reg = new PromptRegistry();
    expect(() => reg.resolve('missing')).toThrow(/'missing' not registered/);
  });

  it('throws on unknown version of known id', () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ version: '1.0.0' }));
    expect(() => reg.resolve('sample', '9.9.9')).toThrow(/'sample@9.9.9' not registered/);
  });
});

describe('PromptRegistry.hashOf (C-P0.2)', () => {
  it('is deterministic for the same id+version+template', () => {
    const p1 = makePrompt();
    const p2 = makePrompt(); // fresh object, same content
    expect(PromptRegistry.hashOf(p1)).toBe(PromptRegistry.hashOf(p2));
  });

  it('changes when template changes', () => {
    const p1 = makePrompt({ template: 'a' });
    const p2 = makePrompt({ template: 'b' });
    expect(PromptRegistry.hashOf(p1)).not.toBe(PromptRegistry.hashOf(p2));
  });

  it('changes when version changes', () => {
    const p1 = makePrompt({ version: '1.0.0' });
    const p2 = makePrompt({ version: '1.0.1' });
    expect(PromptRegistry.hashOf(p1)).not.toBe(PromptRegistry.hashOf(p2));
  });

  it('ignores description + schemaVersion (metadata-only fields)', () => {
    const p1 = makePrompt();
    const p2 = makePrompt({ description: 'added later', schemaVersion: 'X@2' });
    expect(PromptRegistry.hashOf(p1)).toBe(PromptRegistry.hashOf(p2));
  });

  it('produces a 64-hex-char SHA-256 digest', () => {
    expect(PromptRegistry.hashOf(makePrompt())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('PromptRegistry.list (C-P0.2)', () => {
  it('emits PromptInfo per registered version, including hash', () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ version: '1.0.0', description: 'v1' }));
    reg.register(makePrompt({ version: '1.1.0', template: 'v2', schemaVersion: 'X@1' }));
    const info = reg.list();
    expect(info).toHaveLength(2);
    for (const row of info) {
      expect(row.id).toBe('sample');
      expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(info.find((r) => r.version === '1.0.0')?.description).toBe('v1');
    expect(info.find((r) => r.version === '1.1.0')?.schemaVersion).toBe('X@1');
  });
});
