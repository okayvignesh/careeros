import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SkillRow {
  id: string;
  name: string;
  cluster: string | null;
  aliases: string[];
  level: number;
  proficiency: number;
  confidence: number;
  evidenceCount: number;
  recencyDays: number;
  historicalDemonstrated: boolean;
}

export interface SkillEvidenceRow {
  id: string;
  kind: string;
  signal: string;
  weightHint: number | null;
  sourceRef: Record<string, unknown> | null;
  observedAt: string;
}

export interface SkillEventRow {
  id: string;
  rule: string;
  reason: string;
  evidenceId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  timestamp: string;
}

export interface SkillDetail {
  skill: SkillRow;
  evidence: SkillEvidenceRow[];
  events: SkillEventRow[];
}

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<SkillRow[]> {
    // Left-join: every seeded skill appears, even ones the user has no state for yet.
    const rows = await this.prisma.skill.findMany({
      include: {
        candidateSkillStates: {
          where: { userId },
          take: 1,
        },
      },
      orderBy: [{ cluster: 'asc' }, { name: 'asc' }],
    });
    return rows.map((s) => {
      const st = s.candidateSkillStates[0];
      return {
        id: s.id,
        name: s.name,
        cluster: s.cluster,
        aliases: s.aliases,
        level: st?.level ?? 1,
        proficiency: st ? Number(st.proficiency) : 0,
        confidence: st ? Number(st.confidence) : 0,
        evidenceCount: st?.evidenceCount ?? 0,
        recencyDays: st?.recencyDays ?? -1,
        historicalDemonstrated: st?.historicalDemonstrated ?? false,
      };
    });
  }

  async detail(userId: string, skillId: string): Promise<SkillDetail> {
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
      include: { candidateSkillStates: { where: { userId }, take: 1 } },
    });
    if (!skill) throw new NotFoundException(`Skill '${skillId}' not found`);

    const [evidence, events] = await Promise.all([
      this.prisma.evidence.findMany({
        where: { userId, skillId },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      this.prisma.skillStateEvent.findMany({
        where: { userId, skillId },
        orderBy: { timestamp: 'desc' },
        take: 20,
      }),
    ]);

    const st = skill.candidateSkillStates[0];
    return {
      skill: {
        id: skill.id,
        name: skill.name,
        cluster: skill.cluster,
        aliases: skill.aliases,
        level: st?.level ?? 1,
        proficiency: st ? Number(st.proficiency) : 0,
        confidence: st ? Number(st.confidence) : 0,
        evidenceCount: st?.evidenceCount ?? 0,
        recencyDays: st?.recencyDays ?? -1,
        historicalDemonstrated: st?.historicalDemonstrated ?? false,
      },
      evidence: evidence.map((e) => ({
        id: e.id,
        kind: e.kind,
        signal: e.signal,
        weightHint: e.weightHint == null ? null : Number(e.weightHint),
        sourceRef: e.sourceRef as Record<string, unknown> | null,
        observedAt: e.observedAt.toISOString(),
      })),
      events: events.map((ev) => ({
        id: ev.id,
        rule: ev.rule,
        reason: ev.reason,
        evidenceId: ev.evidenceId,
        beforeJson: ev.beforeJson,
        afterJson: ev.afterJson,
        timestamp: ev.timestamp.toISOString(),
      })),
    };
  }
}
