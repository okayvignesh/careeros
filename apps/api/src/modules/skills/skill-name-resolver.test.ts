import { describe, expect, it } from 'vitest';
import {
  normalizeSkillName,
  resolveSkillId,
  resolveSkillNamesToIds,
  type CatalogueEntry,
} from './skill-name-resolver';

// Shape mirrors the seeded ESCO subset (apps/api/src/seed/esco.data.json).
const CATALOGUE: CatalogueEntry[] = [
  { id: 'js', name: 'JavaScript', aliases: ['javascript', 'ecmascript', 'es6'] },
  { id: 'ts', name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { id: 'python', name: 'Python', aliases: ['python', 'py', 'python3'] },
  { id: 'cpp', name: 'C++', aliases: ['c++', 'cpp'] },
  { id: 'csharp', name: 'C#', aliases: ['c#', 'csharp'] },
  { id: 'react', name: 'React', aliases: ['react', 'reactjs', 'react.js'] },
  { id: 'nodejs', name: 'Node.js', aliases: ['node', 'nodejs', 'node.js'] },
  { id: 'react-native', name: 'React Native', aliases: ['react-native', 'rn'] },
  { id: 'aws-cloud', name: 'AWS Cloud' },
  { id: 'gcp-cloud', name: 'Google Cloud' },
];

describe('normalizeSkillName', () => {
  it('folds case + punctuation but keeps C++ / C#', () => {
    expect(normalizeSkillName('  React.js  ')).toBe('react js');
    expect(normalizeSkillName('C++')).toBe('c++');
    expect(normalizeSkillName('C#')).toBe('c#');
    expect(normalizeSkillName('Node.JS')).toBe('node js');
    expect(normalizeSkillName('  Hello,   World ')).toBe('hello world');
  });
});

describe('resolveSkillId', () => {
  it('resolves by exact id', () => {
    expect(resolveSkillId('ts', CATALOGUE)).toBe('ts');
  });

  it('resolves case/punctuation-normalized name and alias', () => {
    expect(resolveSkillId('Typescript', CATALOGUE)).toBe('ts');
    expect(resolveSkillId('react.js', CATALOGUE)).toBe('react');
    expect(resolveSkillId('JavaScript', CATALOGUE)).toBe('js');
    expect(resolveSkillId('C++', CATALOGUE)).toBe('cpp');
    expect(resolveSkillId('c#', CATALOGUE)).toBe('csharp');
  });

  it('token-matches an uncontracted label uniquely (node → Node.js)', () => {
    expect(resolveSkillId('Node', CATALOGUE)).toBe('nodejs');
  });

  it('refuses ambiguous token matches rather than guessing', () => {
    // "cloud" is a token-subset of both AWS Cloud and Google Cloud → null.
    expect(resolveSkillId('cloud', CATALOGUE)).toBeNull();
    // Single-character terms never token-match (guards "C" eating the world).
    expect(resolveSkillId('c', CATALOGUE)).toBeNull();
  });

  it('never invents an id for an unknown / empty term', () => {
    expect(resolveSkillId('Fortran', CATALOGUE)).toBeNull();
    expect(resolveSkillId('   ', CATALOGUE)).toBeNull();
  });
});

describe('resolveSkillNamesToIds', () => {
  it('accepts a mix of ids and names, dedupes, preserves order, drops unknowns', () => {
    expect(
      resolveSkillNamesToIds(['ts', 'React.js', 'not-a-skill', 'ts', 'Python'], CATALOGUE),
    ).toEqual(['ts', 'react', 'python']);
  });
});
