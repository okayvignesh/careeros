import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/// C-P1.3: shape returned by `resolveByAlias`. Deliberately narrow -- callers
/// (skill extractors, job-import stages, resume graders) only need the id +
/// display name + the matched alias for logging.
export interface ResolvedSkill {
  id: string;
  name: string;
  cluster: string | null;
  category: string | null;
  matchedOn: 'name' | 'alias' | 'id';
}

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

  /// C-P1.3: resolve a free-form term (e.g. "K8s", "Postgres", "react.js") to
  /// the canonical Skill row via case-insensitive match on `id`, `name`, or
  /// `aliases`. Returns null when no match -- callers decide whether to log,
  /// create a placeholder, or drop the term. Order of preference: exact id ->
  /// name -> alias, so an alias never shadows a real skill named the same.
  async resolveByAlias(term: string): Promise<ResolvedSkill | null> {
    const needle = term.trim().toLowerCase();
    if (!needle) return null;

    // Single query, then in-memory rank. The taxonomy is ~200 rows -- scanning
    // is cheaper than three round-trips with case-insensitive comparators.
    // ponytail: linear scan is fine at this size; move to a Postgres query
    // (`WHERE lower(id)=$1 OR lower(name)=$1 OR $1 = ANY(lower_aliases)`) if
    // the taxonomy ever grows past a few thousand rows.
    const skills = await this.prisma.skill.findMany({
      select: { id: true, name: true, cluster: true, category: true, aliases: true },
    });

    let byId: ResolvedSkill | null = null;
    let byName: ResolvedSkill | null = null;
    let byAlias: ResolvedSkill | null = null;
    for (const s of skills) {
      if (!byId && s.id.toLowerCase() === needle) {
        byId = { id: s.id, name: s.name, cluster: s.cluster, category: s.category, matchedOn: 'id' };
      }
      if (!byName && s.name.toLowerCase() === needle) {
        byName = { id: s.id, name: s.name, cluster: s.cluster, category: s.category, matchedOn: 'name' };
      }
      if (!byAlias && s.aliases.some((a) => a.toLowerCase() === needle)) {
        byAlias = { id: s.id, name: s.name, cluster: s.cluster, category: s.category, matchedOn: 'alias' };
      }
      if (byId) break; // id match wins outright
    }
    return byId ?? byName ?? byAlias;
  }

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
