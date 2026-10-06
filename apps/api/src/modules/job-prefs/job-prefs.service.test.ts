import { describe, expect, it, vi } from 'vitest';
import {
  dedupeCap,
  deriveLocations,
  inferSeniority,
  inferTargetRoles,
  pickFill,
} from './job-prefs.derive';
import { JobPreferencesService, type JobPreferencesDto } from './job-prefs.service';

describe('job-prefs derive helpers', () => {
  it('inferTargetRoles dedupes case-insensitively and caps at 5', () => {
    expect(
      inferTargetRoles(
        ['Backend Engineer', 'backend engineer', 'SRE', 'Data Engineer', 'Mobile Engineer', 'QA'],
        'Principal Backend Engineer',
      ),
    ).toEqual(['Backend Engineer', 'SRE', 'Data Engineer', 'Mobile Engineer', 'QA']);
  });

  it('deriveLocations splits a resume location and drops blanks', () => {
    expect(deriveLocations('Bengaluru, India / Remote')).toEqual([
      'Bengaluru',
      'India',
      'Remote',
    ]);
    expect(deriveLocations('')).toEqual([]);
  });

  it('inferSeniority reads the candidate titles (lead ranks with staff)', () => {
    expect(inferSeniority(['Senior Software Engineer'])).toEqual(['senior']);
    expect(inferSeniority(['Staff Engineer', 'Tech Lead'])).toEqual(['staff']);
    expect(inferSeniority(['Principal Engineer'])).toEqual(['principal']);
    expect(inferSeniority(['Software Engineer'])).toEqual([]);
  });

  it('pickFill never clears user data and respects onlyFillEmpty', () => {
    expect(pickFill(['mine'], ['derived'], true)).toEqual(['mine']);
    expect(pickFill([], ['derived'], true)).toEqual(['derived']);
    expect(pickFill(['mine'], ['derived'], false)).toEqual(['derived']);
    expect(pickFill(['mine'], [], false)).toEqual(['mine']);
    expect(dedupeCap(['a', 'A', ' b ', ''], 5)).toEqual(['a', 'b']);
  });
});

function makePrisma(opts: {
  facts: Array<{ kind: string; content: unknown }>;
  skills: Array<{ skillId: string }>;
  existing?: Record<string, unknown> | null;
}) {
  let row = opts.existing ?? null;
  return {
    resumeFact: { findMany: vi.fn(async () => opts.facts) },
    candidateSkillState: { findMany: vi.fn(async () => opts.skills) },
    userJobPreferences: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(
        async ({ create }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          row = { ...create, updatedAt: new Date('2026-01-02T00:00:00Z') };
          return row;
        },
      ),
    },
  };
}

const FACTS = [
  {
    kind: 'employment',
    content: {
      company: 'Acme',
      title: 'Senior Backend Engineer',
      start: '2021',
      end: null,
      bullets: [],
    },
  },
  { kind: 'headline', content: { text: 'Backend Engineer' } },
  { kind: 'location', content: { text: 'Bengaluru, India' } },
];

describe('JobPreferencesService.deriveFromResume', () => {
  it('fills blanks from the resume + skill graph on first run', async () => {
    const prisma = makePrisma({
      facts: FACTS,
      skills: [{ skillId: 'ts' }, { skillId: 'react' }],
      existing: null,
    });
    const svc = new JobPreferencesService(prisma as never);

    const out = await svc.deriveFromResume('user-a');

    expect(out.targetRoles).toEqual(['Senior Backend Engineer', 'Backend Engineer']);
    expect(out.locations).toEqual(['Bengaluru', 'India']);
    expect(out.seniority).toEqual(['senior']);
    // Must-have is an exclusive filter — never auto-derived from the resume.
    expect(out.mustHaveSkills).toEqual([]);
    // Comp band + blacklist + dealbreakers stay empty for the user to fill.
    expect(out.compMin ?? null).toBeNull();
    expect(out.companyBlacklist).toEqual([]);
    expect(out.dealbreakerSkills).toEqual([]);
    // MUTATION SMOKE: remove the resumeFact/candidateSkillState reads and every
    // derived array collapses to empty.
  });

  it('onlyFillEmpty:true keeps existing user values, fills the rest', async () => {
    const existing = {
      targetRoles: ['Staff Platform Engineer'],
      locations: [],
      remoteOnly: true,
      compMin: 150000,
      compMax: 220000,
      currency: 'EUR',
      seniority: [],
      mustHaveSkills: [],
      dealbreakerSkills: ['php'],
      companyBlacklist: ['Acme'],
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const prisma = makePrisma({
      facts: FACTS,
      skills: [{ skillId: 'ts' }],
      existing,
    });
    const svc = new JobPreferencesService(prisma as never);

    const out: JobPreferencesDto = await svc.deriveFromResume('user-a');

    expect(out.targetRoles).toEqual(['Staff Platform Engineer']); // untouched
    expect(out.locations).toEqual(['Bengaluru', 'India']); // was empty → filled
    expect(out.seniority).toEqual(['senior']);
    expect(out.mustHaveSkills).toEqual([]); // never derived
    expect(out.compMin).toBe(150000);
    expect(out.currency).toBe('EUR');
    expect(out.remoteOnly).toBe(true);
    expect(out.dealbreakerSkills).toEqual(['php']);
    expect(out.companyBlacklist).toEqual(['Acme']);
    // MUTATION SMOKE: drop the onlyFillEmpty guard in pickFill and targetRoles
    // flips to the derived ['Senior Backend Engineer', 'Backend Engineer'].
  });

  it('clears a must-have set that exactly matches the demonstrated skills (auto-added)', async () => {
    const existing = {
      targetRoles: ['Backend Engineer'],
      locations: ['Bengaluru'],
      remoteOnly: false,
      currency: 'USD',
      seniority: ['senior'],
      mustHaveSkills: ['ts', 'react'],
      dealbreakerSkills: [],
      companyBlacklist: [],
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const prisma = makePrisma({
      facts: FACTS,
      skills: [{ skillId: 'ts' }, { skillId: 'react' }],
      existing,
    });
    const out = await new JobPreferencesService(prisma as never).deriveFromResume('user-a');
    expect(out.mustHaveSkills).toEqual([]);
  });

  it('preserves a user-chosen must-have set that differs from the demonstrated skills', async () => {
    const existing = {
      targetRoles: ['Backend Engineer'],
      locations: ['Bengaluru'],
      remoteOnly: false,
      currency: 'USD',
      seniority: ['senior'],
      mustHaveSkills: ['postgres'],
      dealbreakerSkills: [],
      companyBlacklist: [],
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const prisma = makePrisma({
      facts: FACTS,
      skills: [{ skillId: 'ts' }, { skillId: 'react' }],
      existing,
    });
    const out = await new JobPreferencesService(prisma as never).deriveFromResume('user-a');
    expect(out.mustHaveSkills).toEqual(['postgres']);
  });
});
