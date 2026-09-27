import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  basename,
  extension,
  EXTENSION_TO_SKILL,
  FILENAME_TO_SKILL,
} from './language-detect';

describe('basename', () => {
  it('handles posix + windows separators', () => {
    expect(basename('src/a/b.ts')).toBe('b.ts');
    expect(basename('src\\a\\b.ts')).toBe('b.ts');
    expect(basename('b.ts')).toBe('b.ts');
    expect(basename('')).toBe('');
  });
});

describe('extension', () => {
  it('lower-cases and strips leading dot', () => {
    expect(extension('foo.TS')).toBe('ts');
    expect(extension('a/b/c.py')).toBe('py');
  });
  it('returns null for dotfiles and extensionless files', () => {
    expect(extension('.gitignore')).toBeNull();
    expect(extension('Makefile')).toBeNull();
  });
  it('handles multiple dots by taking the last segment', () => {
    expect(extension('foo.spec.ts')).toBe('ts');
  });
});

describe('detectLanguage', () => {
  it('maps common extensions to expected skill ids', () => {
    expect(detectLanguage('a/b.ts')).toBe('ts');
    expect(detectLanguage('a/b.tsx')).toBe('ts');
    expect(detectLanguage('a/b.js')).toBe('js');
    expect(detectLanguage('a/b.py')).toBe('python');
    expect(detectLanguage('a/b.go')).toBe('go');
    expect(detectLanguage('a/b.rs')).toBe('rust');
    expect(detectLanguage('a/b.rb')).toBe('ruby');
    expect(detectLanguage('a/b.java')).toBe('java');
    expect(detectLanguage('a/b.kt')).toBe('kotlin');
    expect(detectLanguage('a/b.swift')).toBe('swift');
    expect(detectLanguage('a/b.cpp')).toBe('cpp');
    expect(detectLanguage('a/b.cs')).toBe('csharp');
    expect(detectLanguage('a/b.tf')).toBe('terraform');
  });

  it('detects bare filenames without extensions', () => {
    expect(detectLanguage('Dockerfile')).toBe('docker');
    expect(detectLanguage('Makefile')).toBe('make');
    expect(detectLanguage('some/dir/Dockerfile.dev')).toBe('docker');
  });

  it('falls back to shebang when extension is missing', () => {
    expect(detectLanguage('bin/deploy', '#!/usr/bin/env python3')).toBe('python');
    expect(detectLanguage('bin/deploy', '#!/bin/bash')).toBe('shell');
    expect(detectLanguage('bin/deploy', '#!/usr/bin/env node')).toBe('js');
  });

  it('ignores shebang when a real extension already matched', () => {
    // .py extension already wins; shebang is not consulted.
    expect(detectLanguage('run.py', '#!/bin/sh')).toBe('python');
  });

  it('returns null for unknown files', () => {
    expect(detectLanguage('README.md')).toBeNull();
    expect(detectLanguage('image.png')).toBeNull();
    expect(detectLanguage('random.xyz')).toBeNull();
  });

  it('covers 150+ extensions in the map', () => {
    // Guards against accidental deletion of a big chunk of the map.
    expect(Object.keys(EXTENSION_TO_SKILL).length).toBeGreaterThanOrEqual(100);
    expect(Object.keys(FILENAME_TO_SKILL).length).toBeGreaterThan(5);
  });

  it('folds js/ts variants to a single skill id', () => {
    expect(detectLanguage('a.mjs')).toBe('js');
    expect(detectLanguage('a.cjs')).toBe('js');
    expect(detectLanguage('a.mts')).toBe('ts');
    expect(detectLanguage('a.cts')).toBe('ts');
  });
});
