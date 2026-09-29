import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AUTO_LINK_THRESHOLD,
  bestMatch,
  type EmailClass,
  type EmailFields,
  type MatchScore,
} from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E.7 inbox triage.
 *
 * Consumers (email-ingest worker, once E.5b wire lands) call `ingest()`
 * with the classified email + parsed (company, role) fields. The service
 * runs a fuzzy match against the user's open applications, upserts an
 * InboxItem, and auto-creates an EmailApplicationLink if the confidence
 * is >= AUTO_LINK_THRESHOLD.
 *
 * User-facing surface: list, link (manual override), unlink, dismiss.
 *
 * ponytail: matching runs in-memory. For a user with 1000+ applications
 * (unlikely for a personal tool) we would move the similarity pass into
 * Postgres via pg_trgm; today the linear scan is faster to reason about.
 */

export interface IngestInput {
  userId: string;
  emailId: string;
  from: string;
  subject: string;
  snippet: string | null;
  emailClass: EmailClass;
  classConfidence: number;
  /** Company + role extracted from the email (E.6 parsers OR future extractor). */
  parsed: EmailFields;
}

export interface IngestResult {
  inboxItemId: string;
  status: 'new' | 'linked' | 'dismissed';
  linkedApplicationId: string | null;
  matchConfidence: number | null;
  matchMethod: string | null;
}

const OPEN_STATES = ['interested', 'applied', 'interviewing', 'offer'] as const;

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingest(input: IngestInput): Promise<IngestResult> {
    const openApps = await this.prisma.application.findMany({
      where: { userId: input.userId, state: { in: OPEN_STATES as unknown as string[] } },
      select: { id: true, jobId: true },
    });
    // Two-phase: fetch open apps then their jobs (Application has no
    // relation to NormalizedJob per schema.prisma).
    const jobs = openApps.length > 0
      ? await this.prisma.normalizedJob.findMany({
          where: { id: { in: openApps.map((a) => a.jobId) } },
          select: { id: true, title: true, company: true },
        })
      : [];
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const candidates = openApps
      .map((a) => {
        const job = jobById.get(a.jobId);
        if (!job) return null;
        return { id: a.id, company: job.company, role: job.title };
      })
      .filter((v): v is { id: string; company: string; role: string } => v !== null);

    const match: MatchScore | null = bestMatch(input.parsed, candidates);
    const shouldAutoLink = match !== null && match.confidence >= AUTO_LINK_THRESHOLD;

    // Upsert the inbox_item (idempotent on retry).
    const row = await this.prisma.inboxItem.upsert({
      where: { userId_emailId: { userId: input.userId, emailId: input.emailId } },
      create: {
        userId: input.userId,
        emailId: input.emailId,
        fromAddress: input.from.slice(0, 320),
        subject: input.subject.slice(0, 1000),
        snippet: input.snippet?.slice(0, 2000) ?? null,
        class: input.emailClass,
        classConfidence: input.classConfidence,
        linkedApplicationId: shouldAutoLink ? match.applicationId : null,
        status: shouldAutoLink ? 'linked' : 'new',
      },
      update: {
        class: input.emailClass,
        classConfidence: input.classConfidence,
      },
      select: { id: true, status: true, linkedApplicationId: true },
    });

    if (shouldAutoLink) {
      await this.upsertLink(input.userId, row.id, match.applicationId, match.confidence, 'auto');
    }

    return {
      inboxItemId: row.id,
      status: row.status as 'new' | 'linked' | 'dismissed',
      linkedApplicationId: row.linkedApplicationId,
      matchConfidence: match?.confidence ?? null,
      matchMethod: match?.method ?? null,
    };
  }

  async list(
    userId: string,
    filter: { status?: string; classFilter?: string; limit?: number } = {},
  ) {
    const take = Math.min(200, Math.max(1, filter.limit ?? 50));
    return this.prisma.inboxItem.findMany({
      where: {
        userId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.classFilter ? { class: filter.classFilter } : {}),
      },
      orderBy: { arrivedAt: 'desc' },
      take,
      select: {
        id: true,
        emailId: true,
        fromAddress: true,
        subject: true,
        snippet: true,
        class: true,
        classConfidence: true,
        linkedApplicationId: true,
        status: true,
        arrivedAt: true,
        reviewedAt: true,
      },
    });
  }

  async linkManual(userId: string, inboxItemId: string, applicationId: string): Promise<void> {
    const [item, app] = await Promise.all([
      this.prisma.inboxItem.findFirst({ where: { id: inboxItemId, userId } }),
      this.prisma.application.findFirst({ where: { id: applicationId, userId } }),
    ]);
    if (!item) throw new NotFoundException('inbox item not found');
    if (!app) throw new NotFoundException('application not found');
    await this.prisma.$transaction([
      this.prisma.inboxItem.update({
        where: { id: inboxItemId },
        data: {
          linkedApplicationId: applicationId,
          status: 'linked',
          reviewedAt: new Date(),
        },
      }),
      this.prisma.emailApplicationLink.upsert({
        where: { inboxItemId_applicationId: { inboxItemId, applicationId } },
        create: {
          userId,
          inboxItemId,
          applicationId,
          confidence: 1,
          by: 'user',
        },
        update: { unlinkedAt: null, confidence: 1, by: 'user' },
      }),
    ]);
  }

  async unlink(userId: string, inboxItemId: string): Promise<void> {
    const item = await this.prisma.inboxItem.findFirst({
      where: { id: inboxItemId, userId },
      select: { id: true, linkedApplicationId: true },
    });
    if (!item) throw new NotFoundException('inbox item not found');
    if (!item.linkedApplicationId) {
      throw new BadRequestException('inbox item not linked');
    }
    const applicationId = item.linkedApplicationId;
    await this.prisma.$transaction([
      this.prisma.inboxItem.update({
        where: { id: inboxItemId },
        data: {
          linkedApplicationId: null,
          status: 'new',
          reviewedAt: new Date(),
        },
      }),
      this.prisma.emailApplicationLink.updateMany({
        where: { inboxItemId, applicationId, unlinkedAt: null },
        data: { unlinkedAt: new Date() },
      }),
    ]);
  }

  async dismiss(userId: string, inboxItemId: string): Promise<void> {
    const item = await this.prisma.inboxItem.findFirst({
      where: { id: inboxItemId, userId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('inbox item not found');
    await this.prisma.inboxItem.update({
      where: { id: inboxItemId },
      data: { status: 'dismissed', reviewedAt: new Date() },
    });
  }

  private async upsertLink(
    userId: string,
    inboxItemId: string,
    applicationId: string,
    confidence: number,
    by: 'auto' | 'user',
  ): Promise<void> {
    await this.prisma.emailApplicationLink.upsert({
      where: { inboxItemId_applicationId: { inboxItemId, applicationId } },
      create: { userId, inboxItemId, applicationId, confidence, by },
      update: { unlinkedAt: null, confidence, by },
    });
  }
}
