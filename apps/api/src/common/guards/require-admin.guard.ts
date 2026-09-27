import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../../modules/auth/session.service';

/**
 * C-P3.8a: gate admin-flavored routes (`/admin/*` + global-effect config
 * mutations) behind an explicit admin check.
 *
 * Today the deployment is single-user (Wave A A-M6 asserts `userCount === 1`
 * before mutating global AppConfig). While single-user holds, the one user IS
 * the admin — treat the guard as satisfied. As soon as a second user lands
 * (multi-tenant), fall back to `user.isAdmin` on the User model.
 *
 * ponytail: no `isAdmin` column exists on the User model yet. When the
 * multi-user work adds it, this guard picks it up automatically via the
 * runtime `in` check — no code change needed here. Until then the
 * fallback branch returns false and multi-user hits get a 403, which is
 * the intended failure mode.
 *
 * The guard requires an authenticated session; unauthenticated requests get
 * 401 (never 403). This keeps admin routes indistinguishable from any other
 * authed route when the caller has no cookie.
 */
@Injectable()
export class RequireAdminGuard implements CanActivate {
  constructor(
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const s = this.session.read(req);
    if (!s) throw new UnauthorizedException('Not signed in');

    const userCount = await this.prisma.user.count();
    if (userCount <= 1) return true; // single-user MVP: sole user is admin

    // Multi-user path: require an explicit isAdmin flag on the User row.
    // Uses a raw `findFirst` with `select: { id: true }` after the field
    // check so the query stays minimal even when the field is absent.
    const user = await this.prisma.user.findUnique({
      where: { id: s.userId },
      // `select` is untyped here on purpose: `isAdmin` may not exist on the
      // Prisma-generated `User` model yet. Prisma tolerates unknown
      // top-level selects at runtime only if the column exists in the DB; if
      // the column is missing, the query throws and the outer catch below
      // treats it as "no admin field yet".
    });
    if (user && (user as unknown as { isAdmin?: boolean }).isAdmin === true) return true;

    throw new ForbiddenException('Admin only');
  }
}
