import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_STATES,
  canTransition,
  nextStatesFrom,
  type ApplicationState,
} from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface ApplicationEventDto {
  id: string;
  fromState: string | null;
  toState: string;
  byActor: string;
  notes: string | null;
  at: string;
}

export interface ApplicationDto {
  id: string;
  jobId: string;
  jobTitle: string | null;
  jobCompany: string | null;
  jobUrl: string | null;
  state: ApplicationState;
  appliedAt: string | null;
  resumeVariantId: string | null;
  coverLetterId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  nextStates: ApplicationState[];
  events: ApplicationEventDto[];
}

function isState(x: string): x is ApplicationState {
  return (APPLICATION_STATES as readonly string[]).includes(x);
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent create. Unique (userId, jobId) index handles the race — a
   * P2002 collision means "already tracking, just return the existing row".
   */
  async create(userId: string, jobId: string): Promise<ApplicationDto> {
    const job = await this.prisma.normalizedJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    try {
      const app = await this.prisma.application.create({
        data: {
          userId,
          jobId,
          events: {
            create: { toState: 'interested', byActor: 'user' },
          },
        },
      });
      return this.getById(userId, app.id);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        // Already tracking — return existing.
        const existing = await this.prisma.application.findFirst({ where: { userId, jobId } });
        if (existing) return this.getById(userId, existing.id);
      }
      throw err;
    }
  }

  async listForUser(userId: string): Promise<ApplicationDto[]> {
    const rows = await this.prisma.application.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    if (rows.length === 0) return [];
    const jobIds = Array.from(new Set(rows.map((r) => r.jobId)));
    const jobs = await this.prisma.normalizedJob.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, title: true, company: true, canonicalUrl: true },
    });
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    // Batched event fetch keeps this O(1) query count regardless of pool size.
    const eventsByApp = new Map<string, ApplicationEventDto[]>();
    const events = await this.prisma.applicationEvent.findMany({
      where: { applicationId: { in: rows.map((r) => r.id) } },
      orderBy: { at: 'asc' },
    });
    for (const e of events) {
      const list = eventsByApp.get(e.applicationId) ?? [];
      list.push({
        id: e.id,
        fromState: e.fromState,
        toState: e.toState,
        byActor: e.byActor,
        notes: e.notes,
        at: e.at.toISOString(),
      });
      eventsByApp.set(e.applicationId, list);
    }
    return rows.map((r) => this.dtoOf(r, jobById.get(r.jobId), eventsByApp.get(r.id) ?? []));
  }

  async getById(userId: string, id: string): Promise<ApplicationDto> {
    const row = await this.prisma.application.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Application not found');
    const job = await this.prisma.normalizedJob.findUnique({
      where: { id: row.jobId },
      select: { id: true, title: true, company: true, canonicalUrl: true },
    });
    const events = await this.prisma.applicationEvent.findMany({
      where: { applicationId: id },
      orderBy: { at: 'asc' },
    });
    return this.dtoOf(
      row,
      job ?? undefined,
      events.map((e) => ({
        id: e.id,
        fromState: e.fromState,
        toState: e.toState,
        byActor: e.byActor,
        notes: e.notes,
        at: e.at.toISOString(),
      })),
    );
  }

  async transition(
    userId: string,
    id: string,
    toState: string,
    notes?: string,
  ): Promise<ApplicationDto> {
    if (!isState(toState)) {
      throw new BadRequestException(`Unknown state: ${toState}`);
    }
    const app = await this.prisma.application.findFirst({ where: { id, userId } });
    if (!app) throw new NotFoundException('Application not found');
    if (!isState(app.state)) {
      throw new BadRequestException(`Corrupt state in DB: ${app.state}`);
    }
    if (!canTransition(app.state, toState)) {
      throw new BadRequestException(`Cannot transition ${app.state} → ${toState}`);
    }
    await this.prisma.$transaction([
      this.prisma.application.update({
        where: { id },
        data: {
          state: toState,
          ...(toState === 'applied' && !app.appliedAt ? { appliedAt: new Date() } : {}),
        },
      }),
      this.prisma.applicationEvent.create({
        data: {
          applicationId: id,
          fromState: app.state,
          toState,
          byActor: 'user',
          ...(notes ? { notes } : {}),
        },
      }),
    ]);
    return this.getById(userId, id);
  }

  async attach(
    userId: string,
    id: string,
    input: { resumeVariantId?: string | null; coverLetterId?: string | null; notes?: string | null },
  ): Promise<ApplicationDto> {
    const app = await this.prisma.application.findFirst({ where: { id, userId } });
    if (!app) throw new NotFoundException('Application not found');
    // Only attach artifacts the user owns.
    if (input.resumeVariantId) {
      const owned = await this.prisma.resumeVariant.findFirst({
        where: { id: input.resumeVariantId, userId },
      });
      if (!owned) throw new NotFoundException('Resume variant not found');
    }
    if (input.coverLetterId) {
      const owned = await this.prisma.coverLetter.findFirst({
        where: { id: input.coverLetterId, userId },
      });
      if (!owned) throw new NotFoundException('Cover letter not found');
    }
    await this.prisma.application.update({
      where: { id },
      data: {
        ...(input.resumeVariantId !== undefined ? { resumeVariantId: input.resumeVariantId } : {}),
        ...(input.coverLetterId !== undefined ? { coverLetterId: input.coverLetterId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    return this.getById(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.application.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw new NotFoundException('Application not found');
  }

  private dtoOf(
    row: {
      id: string;
      jobId: string;
      state: string;
      appliedAt: Date | null;
      resumeVariantId: string | null;
      coverLetterId: string | null;
      notes: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    job: { title: string; company: string; canonicalUrl: string } | undefined,
    events: ApplicationEventDto[],
  ): ApplicationDto {
    const state = isState(row.state) ? row.state : 'interested';
    return {
      id: row.id,
      jobId: row.jobId,
      jobTitle: job?.title ?? null,
      jobCompany: job?.company ?? null,
      jobUrl: job?.canonicalUrl ?? null,
      state,
      appliedAt: row.appliedAt?.toISOString() ?? null,
      resumeVariantId: row.resumeVariantId,
      coverLetterId: row.coverLetterId,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      nextStates: [...nextStatesFrom(state)],
      events,
    };
  }
}
