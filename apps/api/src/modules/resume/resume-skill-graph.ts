// Resume → candidate skill graph. Turns verified resume `skill` facts into
// append-only `Evidence` rows (kind=`document`, signal=`presence`) and lets the
// aggregator fold them into `candidate_skill_state` alongside GitHub code
// evidence. Kept standalone (takes a narrow Prisma-shaped port) so it is unit
// testable without Nest or a live database.
//
// Idempotency: `commit()` delete+recreates `resume_facts`, so the DB factId is
// NOT stable across re-commits. We therefore dedupe on the stable natural key
// `(userId, skillId, sourceRef.kind='resume_fact')` — one resume-derived row per
// skill, ever — while `sourceRef.factId` still records the fact that raised it.
// Keying on factId alone (as the ticket literally reads) would add a fresh row
// on every re-commit and inflate evidence_count.
import { resolveSkillId, type CatalogueEntry } from '../skills/skill-name-resolver';

export const RESUME_FACT_SOURCE_KIND = 'resume_fact';
/** Document-kind weight for "listed in resume". Modest: a listing is not proof. */
export const RESUME_SKILL_WEIGHT = 0.4;

export interface ResumeSkillFactInput {
  factId: string;
  name: string;
  evidence?: string | null;
}

export interface ResolvedResumeSkill {
  factId: string;
  skillId: string;
  name: string;
  evidence?: string;
}

/**
 * Map verified resume skill facts to catalogue ids. Skills that don't resolve,
 * or that resolve to an already-seen id, are dropped. Order-preserving.
 */
export function resolveResumeSkillFacts(
  facts: readonly ResumeSkillFactInput[],
  catalogue: readonly CatalogueEntry[],
): ResolvedResumeSkill[] {
  const seen = new Set<string>();
  const out: ResolvedResumeSkill[] = [];
  for (const fact of facts) {
    const name = typeof fact.name === 'string' ? fact.name.trim() : '';
    if (!name) continue;
    const skillId = resolveSkillId(name, catalogue);
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    const evidence = typeof fact.evidence === 'string' ? fact.evidence.trim() : '';
    out.push({
      factId: fact.factId,
      skillId,
      name,
      ...(evidence ? { evidence } : {}),
    });
  }
  return out;
}

/** Minimal Prisma port — the real client is structurally compatible. */
export interface ResumeGraphPrisma {
  resumeFact: {
    findMany(args: {
      where: { userId: string; kind: string };
    }): Promise<Array<{ id: string; content: unknown }>>;
  };
  skill: {
    findMany(args: {
      select: { id: true; name: true; aliases: true };
    }): Promise<CatalogueEntry[]>;
  };
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  evidence: {
    create(args: {
      data: {
        userId: string;
        skillId: string;
        kind: string;
        signal: string;
        weightHint: number;
        sourceRef: { kind: string; factId: string };
        detail: { name: string; evidence?: string };
        observedAt: Date;
      };
    }): Promise<unknown>;
  };
}

function readName(content: unknown): string {
  if (content && typeof content === 'object' && 'name' in content) {
    const name = (content as { name?: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

function readEvidence(content: unknown): string | null {
  if (content && typeof content === 'object' && 'evidence' in content) {
    const e = (content as { evidence?: unknown }).evidence;
    return typeof e === 'string' ? e : null;
  }
  return null;
}

export interface PersistResumeEvidenceResult {
  /** Skills we (re)aggregated — includes already-present rows. */
  touchedSkillIds: string[];
  /** Skills for which a new Evidence row was written this run. */
  insertedSkillIds: string[];
}

/**
 * Insert one Evidence row per resolved skill, skipping any skill that already
 * has a resume_fact-sourced row. Returns every touched skill so the caller can
 * run `syncSkillState` for all of them (idempotent, cheap).
 */
export async function persistResumeSkillEvidence(
  prisma: ResumeGraphPrisma,
  userId: string,
  resolved: readonly ResolvedResumeSkill[],
  now: Date,
): Promise<PersistResumeEvidenceResult> {
  const touchedSkillIds: string[] = [];
  const insertedSkillIds: string[] = [];
  for (const entry of resolved) {
    // JSON-path predicate mirrors the github-sync dedupe: Prisma's JSON
    // `equals` needs a full deep match, which would break on shape drift.
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM evidence
      WHERE "userId" = ${userId}::uuid
        AND "skillId" = ${entry.skillId}
        AND "sourceRef"->>'kind' = ${RESUME_FACT_SOURCE_KIND}
      LIMIT 1
    `;
    if (existing.length === 0) {
      await prisma.evidence.create({
        data: {
          userId,
          skillId: entry.skillId,
          kind: 'document',
          signal: 'presence',
          weightHint: RESUME_SKILL_WEIGHT,
          sourceRef: { kind: RESUME_FACT_SOURCE_KIND, factId: entry.factId },
          detail: { name: entry.name, ...(entry.evidence ? { evidence: entry.evidence } : {}) },
          observedAt: now,
        },
      });
      insertedSkillIds.push(entry.skillId);
    }
    touchedSkillIds.push(entry.skillId);
  }
  return { touchedSkillIds, insertedSkillIds };
}

/**
 * Full pipeline for `resume.service.commit`: read skill facts + catalogue,
 * resolve, persist idempotently, then sync each skill's aggregate state.
 * `sync` is injected so callers (and tests) can stub the aggregator. Errors are
 * NOT swallowed here — the caller decides (commit treats this as non-fatal).
 */
export async function rebuildResumeSkillGraph(
  prisma: ResumeGraphPrisma,
  userId: string,
  now: Date,
  sync: (skillId: string) => Promise<void>,
): Promise<{ resolved: number; inserted: number }> {
  const [facts, catalogue] = await Promise.all([
    prisma.resumeFact.findMany({ where: { userId, kind: 'skill' } }),
    prisma.skill.findMany({ select: { id: true, name: true, aliases: true } }),
  ]);
  if (catalogue.length === 0) return { resolved: 0, inserted: 0 };

  const resolved = resolveResumeSkillFacts(
    facts.map((f) => ({
      factId: f.id,
      name: readName(f.content),
      evidence: readEvidence(f.content),
    })),
    catalogue,
  );
  if (resolved.length === 0) return { resolved: 0, inserted: 0 };

  const { touchedSkillIds, insertedSkillIds } = await persistResumeSkillEvidence(
    prisma,
    userId,
    resolved,
    now,
  );
  for (const skillId of touchedSkillIds) {
    await sync(skillId);
  }
  return { resolved: resolved.length, inserted: insertedSkillIds.length };
}
