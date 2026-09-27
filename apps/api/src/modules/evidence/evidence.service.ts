import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface EvidenceRow {
  id: string;
  skillId: string;
  skillName: string;
  kind: string;
  signal: string;
  weightHint: number | null;
  sourceRef: Record<string, unknown> | null;
  observedAt: string;
}

export interface EvidenceQuery {
  kinds?: string[];
  signals?: string[];
  skillId?: string;
  sinceDays?: number;
  limit?: number;
}

const ALLOWED_KINDS = new Set(['self', 'document', 'code', 'assessment', 'behavioral', 'outcome']);

@Injectable()
export class EvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: EvidenceQuery): Promise<EvidenceRow[]> {
    const where: Prisma.EvidenceWhereInput = { userId };
    if (query.kinds && query.kinds.length > 0) {
      where.kind = { in: query.kinds.filter((k) => ALLOWED_KINDS.has(k)) };
    }
    if (query.signals && query.signals.length > 0) {
      where.signal = { in: query.signals };
    }
    if (query.skillId) {
      where.skillId = query.skillId;
    }
    if (query.sinceDays && query.sinceDays > 0) {
      where.observedAt = { gte: new Date(Date.now() - query.sinceDays * 86_400_000) };
    }

    const rows = await this.prisma.evidence.findMany({
      where,
      include: { skill: { select: { name: true } } },
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(query.limit ?? 100, 1), 500),
    });
    return rows.map((r) => ({
      id: r.id,
      skillId: r.skillId,
      skillName: r.skill.name,
      kind: r.kind,
      signal: r.signal,
      weightHint: r.weightHint == null ? null : Number(r.weightHint),
      sourceRef: r.sourceRef as Record<string, unknown> | null,
      observedAt: r.observedAt.toISOString(),
    }));
  }

  async facets(userId: string): Promise<{ kinds: string[]; signals: string[] }> {
    // Distinct enums for the filter dropdowns.
    const rows = await this.prisma.$queryRaw<Array<{ kind: string; signal: string }>>`
      SELECT DISTINCT kind, signal FROM evidence WHERE "userId" = ${userId}::uuid
    `;
    const kinds = [...new Set(rows.map((r) => r.kind))].sort();
    const signals = [...new Set(rows.map((r) => r.signal))].sort();
    return { kinds, signals };
  }
}
