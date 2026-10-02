import { Injectable, NotFoundException } from '@nestjs/common';
import {
  computeMatch,
  type MatchScore,
  type RequiredSkill,
} from '@careeros/job-pipeline';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * C-P4.1 Match scorer + readiness + gap report + explanations.
 *
 * Prisma orchestration only. The weighted formula and every type live in
 * `@careeros/job-pipeline` (`stages/match.ts`) so this service and
 * `JobsService.list` share one scorer — the list can never disagree with the
 * detail for the same job/candidate.
 *
 * ponytail: no `job_match_scores` table for MVP. `computeMatch` is a small
 * pure function around three Prisma reads (job, states, evidence). Recompute
 * on demand keeps the DB honest whenever evidence lands. Cache when either
 * the jobs list needs pre-sorted scores at DB level, or per-user scoring is
 * measurably too slow — neither ceiling is hit today.
 */
// Mirrors the package's MAX_EVIDENCE_PER_STRONG (2) * 2 safety factor from the
// pre-extraction service. Only caps the DB read; per-skill slicing happens in
// `computeMatch`.
const EVIDENCE_TAKE_PER_SKILL = 4;

@Injectable()
export class MatcherService {
  constructor(private readonly prisma: PrismaService) {}

  async scoreJob(userId: string, jobId: string): Promise<MatchScore> {
    const job = await this.prisma.normalizedJob.findUnique({
      where: { id: jobId },
      select: { id: true, skillIds: true },
    });
    if (!job) throw new NotFoundException(`Job '${jobId}' not found`);

    const required: RequiredSkill[] = job.skillIds.map((skillId) => ({
      skillId,
      weight: 1,
    }));

    const [skills, states, evidence] = await Promise.all([
      required.length
        ? this.prisma.skill.findMany({
            where: { id: { in: required.map((r) => r.skillId) } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      required.length
        ? this.prisma.candidateSkillState.findMany({
            where: { userId, skillId: { in: required.map((r) => r.skillId) } },
          })
        : Promise.resolve([] as Array<{
            skillId: string;
            proficiency: unknown;
            recencyDays: number;
          }>),
      required.length
        ? this.prisma.evidence.findMany({
            where: { userId, skillId: { in: required.map((r) => r.skillId) } },
            orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
            // Cap per-request read; per-skill slicing happens below.
            take: required.length * EVIDENCE_TAKE_PER_SKILL,
            select: {
              id: true,
              skillId: true,
              kind: true,
              signal: true,
              observedAt: true,
            },
          })
        : Promise.resolve([] as Array<{
            id: string;
            skillId: string;
            kind: string;
            signal: string;
            observedAt: Date;
          }>),
    ]);

    const nameById = new Map(skills.map((s) => [s.id, s.name]));
    const stateBySkill = new Map(states.map((s) => [s.skillId, s]));
    const evidenceBySkill = new Map<string, typeof evidence>();
    for (const ev of evidence) {
      const bucket = evidenceBySkill.get(ev.skillId) ?? [];
      bucket.push(ev);
      evidenceBySkill.set(ev.skillId, bucket);
    }

    return computeMatch({
      jobId: job.id,
      required,
      nameById,
      stateBySkill,
      evidenceBySkill,
    });
  }
}
