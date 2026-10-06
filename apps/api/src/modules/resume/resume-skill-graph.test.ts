import { describe, expect, it, vi } from 'vitest';
import {
  RESUME_FACT_SOURCE_KIND,
  RESUME_SKILL_WEIGHT,
  persistResumeSkillEvidence,
  rebuildResumeSkillGraph,
  resolveResumeSkillFacts,
  type ResumeGraphPrisma,
} from './resume-skill-graph';

const CATALOGUE = [
  { id: 'js', name: 'JavaScript', aliases: ['javascript', 'es6'] },
  { id: 'ts', name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { id: 'react', name: 'React', aliases: ['react', 'reactjs', 'react.js'] },
  { id: 'nodejs', name: 'Node.js', aliases: ['node'] },
];

describe('resolveResumeSkillFacts', () => {
  it('maps names to catalogue ids, skips unresolved + duplicates', () => {
    const out = resolveResumeSkillFacts(
      [
        { factId: 'f1', name: 'TypeScript', evidence: '5 yrs' },
        { factId: 'f2', name: 'react.js' },
        { factId: 'f3', name: 'Fortran' },
        { factId: 'f4', name: 'TS' }, // resolves to ts again → deduped
      ],
      CATALOGUE,
    );
    expect(out).toEqual([
      { factId: 'f1', skillId: 'ts', name: 'TypeScript', evidence: '5 yrs' },
      { factId: 'f2', skillId: 'react', name: 'react.js' },
    ]);
    // MUTATION SMOKE: drop the `seen` guard and f4 re-appears; drop the
    // resolveSkillId null check and the Fortran fact crashes/inserts an id.
  });

  it('returns nothing for an empty or non-string name', () => {
    expect(resolveResumeSkillFacts([{ factId: 'f', name: '' }], CATALOGUE)).toEqual([]);
  });
});

/** Mock Prisma port: $queryRaw keys on skillId; evidence.create records rows. */
function makePrisma(facts: Array<{ id: string; content: unknown }>) {
  const inserted: Array<{ skillId: string; data: Record<string, unknown> }> = [];
  const present = new Set<string>();
  const queryRaw = vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const skillId = values[1] as string;
    return present.has(skillId) ? [{ id: `ev-${skillId}` }] : [];
  });
  const create = vi.fn(async ({ data }: { data: { skillId: string } }) => {
    inserted.push({ skillId: data.skillId, data: data as unknown as Record<string, unknown> });
    present.add(data.skillId);
    return {};
  });
  const prisma = {
    resumeFact: { findMany: vi.fn(async () => facts) },
    skill: { findMany: vi.fn(async () => CATALOGUE) },
    $queryRaw: queryRaw,
    evidence: { create },
  } as unknown as ResumeGraphPrisma;
  return { prisma, inserted, present, create, queryRaw };
}

describe('persistResumeSkillEvidence — idempotent append-only write', () => {
  it('writes one document/presence row per skill, then skips on re-run', async () => {
    const { prisma, inserted, create } = makePrisma([]);
    const resolved = resolveResumeSkillFacts(
      [
        { factId: 'f1', name: 'TypeScript' },
        { factId: 'f2', name: 'React' },
      ],
      CATALOGUE,
    );

    const first = await persistResumeSkillEvidence(
      prisma,
      'user-a',
      resolved,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(first.insertedSkillIds).toEqual(['ts', 'react']);
    expect(first.touchedSkillIds).toEqual(['ts', 'react']);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]!.data).toMatchObject({
      userId: 'user-a',
      skillId: 'ts',
      kind: 'document',
      signal: 'presence',
      weightHint: RESUME_SKILL_WEIGHT,
      sourceRef: { kind: RESUME_FACT_SOURCE_KIND, factId: 'f1' },
    });

    // Re-run with a DIFFERENT factId (commit regenerates uuids) — the stable
    // (user, skill, sourceRef.kind) key must prevent a second row.
    const second = await persistResumeSkillEvidence(
      prisma,
      'user-a',
      resolveResumeSkillFacts([{ factId: 'f9-new', name: 'TypeScript' }], CATALOGUE),
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(second.insertedSkillIds).toEqual([]);
    expect(second.touchedSkillIds).toEqual(['ts']);
    expect(create).toHaveBeenCalledTimes(2); // still 2 across both runs
    // MUTATION SMOKE: key the dedupe predicate on sourceRef->>'factId' instead
    // of kind and the second run inserts again (create call count → 3).
  });
});

describe('rebuildResumeSkillGraph', () => {
  it('syncs every resolved skill and reports counts', async () => {
    const { prisma } = makePrisma([
      { id: 'fact-1', content: { name: 'TypeScript' } },
      { id: 'fact-2', content: { name: 'Node.js' } },
      { id: 'fact-3', content: { name: 'UnknownLang' } },
    ]);
    const sync = vi.fn(async (_skillId: string) => undefined);

    const result = await rebuildResumeSkillGraph(
      prisma,
      'user-a',
      new Date('2026-01-01T00:00:00Z'),
      sync,
    );

    expect(result).toEqual({ resolved: 2, inserted: 2 });
    expect(sync.mock.calls.map((c) => c[0])).toEqual(['ts', 'nodejs']);
  });

  it('is a no-op when the catalogue is empty', async () => {
    const { prisma } = makePrisma([]);
    (prisma.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const sync = vi.fn(async (_skillId: string) => undefined);
    expect(await rebuildResumeSkillGraph(prisma, 'u', new Date(), sync)).toEqual({
      resolved: 0,
      inserted: 0,
    });
    expect(sync).not.toHaveBeenCalled();
  });
});
