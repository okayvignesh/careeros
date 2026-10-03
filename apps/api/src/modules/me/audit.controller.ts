import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { redact } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../auth/session.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * F.6 audit-log viewer. Read-only, session-scoped: the append-only `audit_log`
 * table is never writable from the app, and every row returned is the caller's
 * own (`userId`), so a multi-user host can't read across tenants.
 *
 * Payloads are redacted server-side before leaving the process — the audit
 * table can legitimately hold action metadata that round-tripped a secret.
 */
@Controller('me/audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('limit', new DefaultValuePipe(DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const userId = this.session.requireUserId(req);
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(`limit must be between 1 and ${MAX_LIMIT}`);
    }
    if (offset < 0) {
      throw new BadRequestException('offset must be >= 0');
    }

    const bounds: { gte?: Date; lte?: Date } = {};
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('from must be an ISO timestamp');
      bounds.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('to must be an ISO timestamp');
      bounds.lte = d;
    }

    const where: Prisma.AuditEventWhereInput = {
      userId,
      ...(actor ? { actor: { contains: actor, mode: 'insensitive' } } : {}),
      ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(bounds.gte || bounds.lte ? { timestamp: bounds } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return {
      total,
      offset,
      limit,
      rows: rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        payload: redact(r.payload),
        ip: r.ip,
        userAgent: r.userAgent,
        timestamp: r.timestamp.toISOString(),
      })),
    };
  }
}
