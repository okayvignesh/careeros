import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface FactRow {
  id: string;
  kind: string;
  content: Record<string, unknown>;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class FactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<FactRow[]> {
    const rows = await this.prisma.resumeFact.findMany({
      where: { userId },
      orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      content: r.content as Record<string, unknown>,
      verified: r.verified,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async setVerified(userId: string, factId: string, verified: boolean): Promise<FactRow> {
    const existing = await this.prisma.resumeFact.findFirst({ where: { id: factId, userId } });
    if (!existing) throw new NotFoundException(`Fact '${factId}' not found`);
    const updated = await this.prisma.resumeFact.update({
      where: { id: factId },
      data: { verified },
    });
    return {
      id: updated.id,
      kind: updated.kind,
      content: updated.content as Record<string, unknown>,
      verified: updated.verified,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async remove(userId: string, factId: string): Promise<void> {
    const existing = await this.prisma.resumeFact.findFirst({ where: { id: factId, userId } });
    if (!existing) throw new NotFoundException(`Fact '${factId}' not found`);
    await this.prisma.resumeFact.delete({ where: { id: factId } });
  }
}
