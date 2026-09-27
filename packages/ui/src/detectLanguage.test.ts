import { describe, expect, it } from 'vitest';
import { detectLanguage } from './detectLanguage';

describe('detectLanguage', () => {
  it('detects TypeScript from `import type`', () => {
    const src = "import type { Foo } from 'bar';\nconst x: string = 'ok';\n";
    expect(detectLanguage(src)).toBe('typescript');
  });

  it('detects TypeScript from interface + typed annotation', () => {
    const src = 'interface User { id: string; age: number; }\n';
    expect(detectLanguage(src)).toBe('typescript');
  });

  it('detects JavaScript from CommonJS require/module.exports', () => {
    const src = "const fs = require('fs');\nmodule.exports = fs;\n";
    expect(detectLanguage(src)).toBe('javascript');
  });

  it('detects JavaScript from plain ESM import + arrow func', () => {
    const src = "import x from 'y';\nconst f = () => 1;\n";
    expect(detectLanguage(src)).toBe('javascript');
  });

  it('detects Python from def block', () => {
    const src = 'def add(a, b):\n    return a + b\n';
    expect(detectLanguage(src)).toBe('python');
  });

  it('detects Python from class + import', () => {
    const src = 'from typing import List\n\nclass Foo:\n    pass\n';
    expect(detectLanguage(src)).toBe('python');
  });

  it('detects Python from shebang', () => {
    const src = '#!/usr/bin/env python3\nprint(1)\n';
    expect(detectLanguage(src)).toBe('python');
  });

  it('detects Go from package + import (', () => {
    const src = 'package main\n\nimport (\n\t"fmt"\n)\n\nfunc main() { fmt.Println("hi") }\n';
    expect(detectLanguage(src)).toBe('go');
  });

  it('detects Go from func + := + fmt.', () => {
    const src = 'package main\nfunc greet(n string) string { s := "hi " + n; fmt.Println(s); return s }\n';
    expect(detectLanguage(src)).toBe('go');
  });

  it('detects SQL from SELECT (any case)', () => {
    expect(detectLanguage('select * from users where id = 1;')).toBe('sql');
    expect(detectLanguage('SELECT id, name FROM t;')).toBe('sql');
  });

  it('detects SQL from CREATE TABLE', () => {
    expect(detectLanguage('CREATE TABLE users (id int primary key);')).toBe('sql');
  });

  it('detects JSON from a well-formed object', () => {
    expect(detectLanguage('{"a":1,"b":[2,3]}')).toBe('json');
  });

  it('detects JSON from a well-formed array', () => {
    expect(detectLanguage('[1,2,3]')).toBe('json');
  });

  it('falls back to typescript for empty input', () => {
    expect(detectLanguage('')).toBe('typescript');
  });

  it('falls back to typescript for ambiguous input', () => {
    expect(detectLanguage('hello world\njust some prose\n')).toBe('typescript');
  });

  it('does not misfire JSON detection on JS object literal that is not valid JSON', () => {
    // Trailing comma / unquoted keys — not valid JSON.
    const src = "{ foo: 'bar', baz: [1,2,3,], }";
    expect(detectLanguage(src)).not.toBe('json');
  });

  it('handles non-string / null-ish input defensively', () => {
    // @ts-expect-error runtime guard
    expect(detectLanguage(undefined)).toBe('typescript');
    // @ts-expect-error runtime guard
    expect(detectLanguage(null)).toBe('typescript');
  });
});
