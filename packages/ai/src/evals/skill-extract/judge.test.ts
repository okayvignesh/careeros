// C-P1.4a: judge unit test. Small, no framework beyond vitest.
import { describe, it, expect } from 'vitest';
import { judgeSkillExtract } from './judge';

describe('judgeSkillExtract', () => {
  it('perfect match: F1 = 1, pass', () => {
    const r = judgeSkillExtract({ skillIds: ['ts', 'react', 'aws'] }, { skills: ['ts', 'react', 'aws'] });
    expect(r.f1).toBe(1);
    expect(r.pass).toBe(true);
    expect(r.fp).toEqual([]);
    expect(r.fn).toEqual([]);
  });

  it('partial match at F1 ~0.8 passes', () => {
    // predicted: {ts, react, aws}, expected: {ts, react, aws, python}
    // P = 3/3 = 1, R = 3/4 = 0.75, F1 = 0.857
    const r = judgeSkillExtract(
      { skillIds: ['ts', 'react', 'aws'] },
      { skills: ['ts', 'react', 'aws', 'python'] },
    );
    expect(r.pass).toBe(true);
    expect(r.f1).toBeGreaterThan(0.85);
    expect(r.f1).toBeLessThan(0.9);
    expect(r.notes).toMatch(/drift/);
  });

  it('half missing: F1 below gate, fail', () => {
    // predicted: {ts}, expected: {ts, react, aws, python}
    // P = 1, R = 0.25, F1 = 0.4
    const r = judgeSkillExtract({ skillIds: ['ts'] }, { skills: ['ts', 'react', 'aws', 'python'] });
    expect(r.pass).toBe(false);
    expect(r.f1).toBeLessThan(0.5);
  });

  it('spurious extras hurt precision', () => {
    // predicted: {ts, react, php, ruby}, expected: {ts, react}
    // P = 2/4 = 0.5, R = 1, F1 = 0.667
    const r = judgeSkillExtract({ skillIds: ['ts', 'react', 'php', 'ruby'] }, { skills: ['ts', 'react'] });
    expect(r.pass).toBe(false);
    expect(r.fp.sort()).toEqual(['php', 'ruby']);
  });

  it('case + whitespace insensitive', () => {
    const r = judgeSkillExtract({ skillIds: ['  AWS ', 'React'] }, { skills: ['aws', 'react'] });
    expect(r.f1).toBe(1);
  });

  it('empty expected + empty predicted: pass', () => {
    const r = judgeSkillExtract({ skillIds: [] }, { skills: [] });
    expect(r.pass).toBe(true);
    expect(r.f1).toBe(1);
  });

  it('empty expected + spurious pred: pass but noted', () => {
    const r = judgeSkillExtract({ skillIds: ['rails'] }, { skills: [] });
    expect(r.pass).toBe(true);
    expect(r.notes).toMatch(/over-generated/);
  });

  it('non-empty expected + empty pred: fail F1=0', () => {
    const r = judgeSkillExtract({ skillIds: [] }, { skills: ['ts'] });
    expect(r.pass).toBe(false);
    expect(r.f1).toBe(0);
  });
});
