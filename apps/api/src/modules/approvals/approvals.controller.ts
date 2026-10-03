import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { clientIp } from '../../common/client-ip';
import { RequireAdminGuard } from '../../common/guards/require-admin.guard';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { RateLimitAuth } from '../auth/throttle.decorator';
import { ApprovalsService } from './approvals.service';
import { APPROVAL_REAUTH_OP, isApprovalKind } from './state-machine';

/**
 * F.1c: approvals REST surface. Session-guarded (all routes read
 * `session.requireUserId`); admin-guarded only when a bulk request touches a
 * `delete_account` item (spec rule 5).
 */
@Controller('me/approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly gate: SensitivityGateService,
  ) {}

  /**
   * Re-verify the signed-in user's password to mint a fresh re-auth window for
   * `approval.decide`. The approve() path reads the same singleton gate, so a
   * successful call here is what turns a 403 "Fresh re-authentication required"
   * into an approvable item. Reuses the password lockout + tight rate limit so
   * this can't become a credential oracle.
   */
  @Post('reauth')
  @HttpCode(200)
  @RateLimitAuth()
  async reauth(@Body() body: { password?: string }, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const password = body?.password;
    if (typeof password !== 'string' || password.length === 0) {
      throw new BadRequestException('password is required');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new UnauthorizedException('Not signed in');
    await this.auth.verifyCredentialsWithLockout(user.email, password, clientIp(req));
    const { expiresAt } = this.gate.withReauthWindow(userId, APPROVAL_REAUTH_OP);
    return { expiresAt };
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('state') state?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    const userId = this.session.requireUserId(req);
    return this.approvals.list({
      userId,
      ...(state === undefined ? {} : { state }),
      ...(limit === undefined ? {} : { limit }),
      cursor: cursor ?? null,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.approvals.getById(userId, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.approvals.approve({ userId, itemId: id });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id') id: string,
    @Body() body: { reason?: string } | undefined,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const reason = body?.reason;
    return this.approvals.cancel({
      userId,
      itemId: id,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  /**
   * Bulk approve. Body: `{ itemIds: string[] }`.
   *
   * Two access checks stack:
   *   1. `session.requireUserId` (all routes).
   *   2. If any item in the batch has `kind === 'delete_account'`, we require
   *      admin (spec rule 5). Single-user MVP: sole user is admin so the
   *      guard is trivially satisfied; multi-user drops back to isAdmin.
   *
   * The service handles the fresh-re-auth gate + bulk threshold and throws
   * ForbiddenException when the caller has not re-authed inside the window.
   */
  @Post('bulk-approve')
  @HttpCode(200)
  async bulkApprove(@Body() body: { itemIds?: unknown }, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    if (!Array.isArray(body?.itemIds) || body.itemIds.length === 0) {
      throw new BadRequestException('itemIds required (non-empty array)');
    }
    const ids: string[] = [];
    for (const v of body.itemIds) {
      if (typeof v !== 'string' || v.length === 0) {
        throw new BadRequestException('itemIds must be non-empty strings');
      }
      ids.push(v);
    }
    // Escalate to admin when the batch contains a destructive kind.
    await this.assertAdminIfDestructive(req, userId, ids);
    return this.approvals.bulkApprove({ userId, itemIds: ids });
  }

  private async assertAdminIfDestructive(
    req: Request,
    userId: string,
    itemIds: string[],
  ): Promise<void> {
    const rows = await this.prisma.approvalItem.findMany({
      where: { id: { in: itemIds }, userId },
      select: { kind: true },
    });
    const anyDestructive = rows.some((r) => isApprovalKind(r.kind) && r.kind === 'delete_account');
    if (!anyDestructive) return;
    // Reuse the shared guard by invoking it directly (Nest doesn't expose a
    // conditional-guard decorator, and we don't want @RequireAdmin() on the
    // whole route because non-destructive batches shouldn't need admin).
    const guard = new RequireAdminGuard(this.session, this.prisma);
    const ok = await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => req }) as never,
    } as never);
    if (!ok) {
      // Guard throws Unauthorized/Forbidden itself; the `!ok` branch is a
      // belt-and-braces safeguard for future guard variants that return false.
      throw new BadRequestException('Admin required for delete_account approvals');
    }
  }
}
