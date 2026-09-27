import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { verify, normalize, type RawJob } from '@careeros/job-pipeline';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { RequireAdmin } from '../../common/decorators/require-admin.decorator';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * C-P3.2e: reject-log admin controller.
 *
 *   GET  /admin/jobs/reject-log?limit=&offset=&reason=&adapter=
 *   GET  /admin/jobs/reject-log/:id
 *   POST /admin/jobs/reject-log/:id/re-verify
 *
 * Every route is admin-gated (RequireAdmin from C-P3.8a). Single-user MVP
 * treats the sole user as admin; multi-user rollout is picked up by the
 * guard's `isAdmin` fallback.
 */
@Controller('admin/jobs/reject-log')
@RequireAdmin()
export class RejectLogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('reason') reason: string | undefined,
    @Query('adapter') adapter: string | undefined,
    @Req() req: Request,
  ) {
    this.session.requireUserId(req);
    const parsedLimit = Number(limit ?? DEFAULT_LIMIT);
    const parsedOffset = Number(offset ?? 0);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive number');
    }
    if (parsedLimit > MAX_LIMIT) {
      throw new BadRequestException(`limit must be <= ${MAX_LIMIT}`);
    }
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
      throw new BadRequestException('offset must be >= 0');
    }

    const where: Prisma.JobRejectLogWhereInput = {};
    if (reason && reason.trim().length > 0) where.reason = reason.trim();
    if (adapter && adapter.trim().length > 0) where.sourceName = adapter.trim();

    const [rows, total] = await Promise.all([
      this.prisma.jobRejectLog.findMany({
        where,
        orderBy: { rejectedAt: 'desc' },
        skip: parsedOffset,
        take: parsedLimit,
        select: {
          id: true,
          jobRawId: true,
          sourceId: true,
          sourceName: true,
          rejectedAt: true,
          reason: true,
          verdict: true,
        },
      }),
      this.prisma.jobRejectLog.count({ where }),
    ]);
    return { total, offset: parsedOffset, limit: parsedLimit, rows };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    this.session.requireUserId(req);
    const row = await this.prisma.jobRejectLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Reject-log entry not found');
    return row;
  }

  /**
   * Re-run verify() on the original raw JD (fetched from jobs_raw). If the
   * verdict is now `trusted` or `flagged`, promote the row into
   * jobs_normalized. The reject-log row is preserved for audit history — a
   * successful promotion writes a `promotedTo` field into `details`.
   *
   * ponytail: does NOT delete the reject-log row. Keeps every promotion
   * traceable; the reject-audit UI can filter promoted vs. still-rejected by
   * checking `details.promotedTo`.
   */
  @Post(':id/re-verify')
  @HttpCode(200)
  async reVerify(@Param('id') id: string, @Req() req: Request) {
    this.session.requireUserId(req);
    const rejectRow = await this.prisma.jobRejectLog.findUnique({ where: { id } });
    if (!rejectRow) throw new NotFoundException('Reject-log entry not found');

    // Rebuild a RawJob shape from the reject-log details + jobs_raw payload
    // if we still have a link. The `details` blob is our source of truth for
    // the JD text (which we deliberately snapshot at reject time). The
    // canonicalUrl / title / company all live there too.
    const details = rejectRow.details as Prisma.JsonObject;
    const canonicalUrl = String(details.canonicalUrl ?? '');
    const title = String(details.title ?? '');
    const company = String(details.company ?? '');
    const rawJd = String(details.rawJd ?? '');
    const sourcePostedAtRaw = details.sourcePostedAt;
    const sourcePostedAt =
      typeof sourcePostedAtRaw === 'string' ? new Date(sourcePostedAtRaw) : null;

    if (!canonicalUrl || !title || !company) {
      throw new BadRequestException('Reject-log entry is missing required details for re-verify');
    }

    const rawJob: RawJob = {
      sourceId: rejectRow.sourceId,
      sourceName: rejectRow.sourceName,
      canonicalUrl,
      title,
      company,
      location: null,
      remote: false,
      description: rawJd,
      sourcePostedAt,
      fetchedAt: new Date(),
      payload: {},
    };

    const normalized = normalize(rawJob);
    const v = verify(normalized);

    if (v.verdict === 'rejected') {
      return {
        promoted: false,
        verdict: v.verdict,
        reasons: v.reasons,
      };
    }

    // Promote: upsert into jobs_normalized. Same shape as JobsService.sync's
    // insert path.
    const upserted = await this.prisma.normalizedJob.upsert({
      where: { canonicalUrl: normalized.canonicalUrl },
      update: {
        title: normalized.title,
        company: normalized.company,
        description: normalized.description,
        sourcePostedAt: normalized.sourcePostedAt,
        lastVerifiedAt: new Date(),
      },
      create: {
        canonicalUrl: normalized.canonicalUrl,
        title: normalized.title,
        company: normalized.company,
        location: normalized.location,
        remote: normalized.remote,
        description: normalized.description,
        sourcePostedAt: normalized.sourcePostedAt,
        primarySource: normalized.primarySource,
        sourceIds: [normalized.sourceTag],
      },
    });

    // Preserve reject-log row + annotate with promotion trace so the audit UI
    // can show "reject → re-verify → promoted at <ts>" without a second table.
    const nextDetails: Record<string, unknown> = { ...(details as Record<string, unknown>) };
    nextDetails.promotedTo = upserted.id;
    nextDetails.promotedAt = new Date().toISOString();
    nextDetails.promotedVerdict = v.verdict;
    await this.prisma.jobRejectLog.update({
      where: { id: rejectRow.id },
      data: {
        details: nextDetails as Prisma.InputJsonValue,
      },
    });

    return {
      promoted: true,
      verdict: v.verdict,
      reasons: v.reasons,
      normalizedJobId: upserted.id,
    };
  }
}
