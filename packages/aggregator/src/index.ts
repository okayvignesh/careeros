// Persistence glue for the skill-state write path. Aggregates evidence[] for one
// (user, skill) into candidate_skill_state and, when the state meaningfully
// changes, appends one skill_state_events row capturing the before/after delta.
//
// AGENTS.md §3.9: every skill-state change must store the reason so users can
// audit *why* proficiency or confidence moved. This package is the single
// implementation of that invariant; apps/api and apps/worker both call it.
//
// Prisma enters through a type-only import so the compiled package has no
// runtime coupling to the generated client.
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  aggregate,
  level,
  type Evidence,
  type EvidenceKind,
  type EvidenceSignal,
  type SkillState,
} from '@careeros/shared';

export async function syncSkillState(
  prisma: PrismaClient,
  userId: string,
  skillId: string,
  now: Date = new Date(),
): Promise<{ state: SkillState; level: number; before: SkillState | null }> {
  const rows = await prisma.evidence.findMany({
    where: { userId, skillId },
    orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
  });
  const evidence: Evidence[] = rows.map((r) => ({
    kind: r.kind as EvidenceKind,
    signal: r.signal as EvidenceSignal,
    observedAt: r.observedAt,
    ...(r.weightHint != null ? { weightHint: Number(r.weightHint) } : {}),
  }));

  const { state } = aggregate(evidence, now);
  const derivedLevel = level(state);

  const existing = await prisma.candidateSkillState.findUnique({
    where: { userId_skillId: { userId, skillId } },
  });
  const before: SkillState | null = existing
    ? {
        proficiency: Number(existing.proficiency),
        confidence: Number(existing.confidence),
        recencyDays: existing.recencyDays,
        historicalDemonstrated: existing.historicalDemonstrated,
        evidenceCount: existing.evidenceCount,
      }
    : null;

  await prisma.candidateSkillState.upsert({
    where: { userId_skillId: { userId, skillId } },
    create: {
      userId,
      skillId,
      proficiency: state.proficiency.toFixed(2),
      confidence: state.confidence.toFixed(3),
      recencyDays: Number.isFinite(state.recencyDays) ? Math.round(state.recencyDays) : 0,
      historicalDemonstrated: state.historicalDemonstrated,
      evidenceCount: state.evidenceCount,
      level: derivedLevel,
    },
    update: {
      proficiency: state.proficiency.toFixed(2),
      confidence: state.confidence.toFixed(3),
      recencyDays: Number.isFinite(state.recencyDays) ? Math.round(state.recencyDays) : 0,
      historicalDemonstrated: state.historicalDemonstrated,
      evidenceCount: state.evidenceCount,
      level: derivedLevel,
    },
  });

  // Skip the event insert when nothing meaningful changed. The "why" panel
  // drowns in noops if every scheduled resync writes a row for a skill whose
  // evidence hasn't shifted.
  if (!stateChanged(before, state, derivedLevel, existing?.level ?? null)) {
    return { state, level: derivedLevel, before };
  }

  const latestEvidenceId = rows.length > 0 ? rows[rows.length - 1]!.id : null;
  await prisma.skillStateEvent.create({
    data: {
      userId,
      skillId,
      evidenceId: latestEvidenceId,
      rule: 'aggregate',
      reason: `Aggregated ${evidence.length} evidence row(s); level ${existing?.level ?? '1'} to ${derivedLevel}`,
      beforeJson: before as unknown as Prisma.InputJsonValue,
      afterJson: { ...state, level: derivedLevel } as unknown as Prisma.InputJsonValue,
    },
  });

  return { state, level: derivedLevel, before };
}

function stateChanged(
  before: SkillState | null,
  after: SkillState,
  afterLevel: number,
  beforeLevel: number | null,
): boolean {
  if (!before) return true; // first row ever = always log
  if (before.evidenceCount !== after.evidenceCount) return true;
  if (before.historicalDemonstrated !== after.historicalDemonstrated) return true;
  if (Math.abs(before.proficiency - after.proficiency) >= 0.01) return true;
  if (Math.abs(before.confidence - after.confidence) >= 0.001) return true;
  if (beforeLevel !== afterLevel) return true;
  return false;
}
