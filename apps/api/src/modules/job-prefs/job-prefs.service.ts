import { Injectable } from '@nestjs/common';
import { syncSkillState } from '@careeros/aggregator';
import type { JobPreferencesInput } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { rebuildResumeSkillGraph } from '../resume/resume-skill-graph';
import {
  DERIVE_SKILLS_CAP,
  deriveLocations,
  inferSeniority,
  inferTargetRoles,
  pickFill,
} from './job-prefs.derive';

export interface JobPreferencesDto extends JobPreferencesInput {
  updatedAt: string | null;
}

const EMPTY: JobPreferencesDto = {
  targetRoles: [],
  locations: [],
  remoteOnly: false,
  currency: 'USD',
  seniority: [],
  mustHaveSkills: [],
  dealbreakerSkills: [],
  companyBlacklist: [],
  updatedAt: null,
};

@Injectable()
export class JobPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<JobPreferencesDto> {
    const row = await this.prisma.userJobPreferences.findUnique({ where: { userId } });
    if (!row) return EMPTY;
    return {
      targetRoles: row.targetRoles,
      locations: row.locations,
      remoteOnly: row.remoteOnly,
      compMin: row.compMin ?? undefined,
      compMax: row.compMax ?? undefined,
      currency: row.currency,
      seniority: row.seniority as JobPreferencesInput['seniority'],
      mustHaveSkills: row.mustHaveSkills,
      dealbreakerSkills: row.dealbreakerSkills,
      companyBlacklist: row.companyBlacklist,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async upsert(userId: string, input: JobPreferencesInput): Promise<JobPreferencesDto> {
    const compMin = input.compMin ?? null;
    const compMax = input.compMax ?? null;
    const data = {
      targetRoles: input.targetRoles,
      locations: input.locations,
      remoteOnly: input.remoteOnly,
      compMin,
      compMax,
      currency: input.currency,
      seniority: input.seniority,
      mustHaveSkills: input.mustHaveSkills,
      dealbreakerSkills: input.dealbreakerSkills,
      companyBlacklist: input.companyBlacklist,
    };
    await this.prisma.userJobPreferences.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.get(userId);
  }

  /**
   * First-run auto-fill: derive targetRoles / locations / seniority /
   * mustHaveSkills from the candidate's resume + skill graph. With
   * `onlyFillEmpty` (the default, and the mode resume commit uses) existing
   * user values are never overwritten — it only fills blanks. Comp band,
   * blacklist and dealbreakers are deliberately left for the user.
   */
  async deriveFromResume(
    userId: string,
    opts: { onlyFillEmpty?: boolean } = {},
  ): Promise<JobPreferencesDto> {
    const onlyFillEmpty = opts.onlyFillEmpty ?? true;

    // Rebuild the resume→skill graph first, so an install whose resume was
    // committed before this feature existed still gets its resume skills folded
    // into candidate_skill_state (and therefore into matching). Idempotent and
    // non-fatal — prefs still derive from whatever graph exists on failure.
    try {
      const now = new Date();
      await rebuildResumeSkillGraph(
        this.prisma as never,
        userId,
        now,
        async (skillId) => {
          await syncSkillState(this.prisma as never, userId, skillId, now);
        },
      );
    } catch {
      // non-fatal: preferences still derive from the existing graph
    }

    const [facts, skillStates, current] = await Promise.all([
      this.prisma.resumeFact.findMany({
        where: { userId },
        select: { kind: true, content: true },
      }),
      // Demonstrated skills: resume presence + GitHub code evidence both land in
      // candidate_skill_state (see resume-skill-graph). Top N by proficiency.
      this.prisma.candidateSkillState.findMany({
        where: { userId, evidenceCount: { gt: 0 } },
        orderBy: [{ proficiency: 'desc' }, { level: 'desc' }],
        take: DERIVE_SKILLS_CAP,
        select: { skillId: true },
      }),
      this.get(userId),
    ]);

    const employmentTitles: string[] = [];
    const locationParts: string[] = [];
    let headline = '';
    for (const fact of facts) {
      const content = (fact.content ?? {}) as Record<string, unknown>;
      if (fact.kind === 'employment' && typeof content.title === 'string') {
        employmentTitles.push(content.title);
      } else if (fact.kind === 'headline' && typeof content.text === 'string') {
        headline = content.text;
      } else if (fact.kind === 'location' && typeof content.text === 'string') {
        locationParts.push(content.text);
      }
    }

    const derived = {
      targetRoles: inferTargetRoles(employmentTitles, headline),
      locations: deriveLocations(locationParts.join(', ')),
      seniority: inferSeniority([...employmentTitles, headline]),
      // IDs, not display names: the schema + relevance filter + match scorer all
      // compare catalogue ids against `job.skillIds`; the Firecrawl query
      // builder resolves these ids to human-readable names at search time.
      mustHaveSkills: skillStates.map((s) => s.skillId),
    };

    const merged: JobPreferencesDto = {
      ...current,
      targetRoles: pickFill(current.targetRoles, derived.targetRoles, onlyFillEmpty),
      locations: pickFill(current.locations, derived.locations, onlyFillEmpty),
      seniority: pickFill(current.seniority, derived.seniority, onlyFillEmpty),
      mustHaveSkills: pickFill(current.mustHaveSkills, derived.mustHaveSkills, onlyFillEmpty),
    };

    return this.upsert(userId, {
      targetRoles: merged.targetRoles,
      locations: merged.locations,
      remoteOnly: merged.remoteOnly,
      compMin: merged.compMin ?? null,
      compMax: merged.compMax ?? null,
      currency: merged.currency,
      seniority: merged.seniority,
      mustHaveSkills: merged.mustHaveSkills,
      dealbreakerSkills: merged.dealbreakerSkills,
      companyBlacklist: merged.companyBlacklist,
    });
  }
}
