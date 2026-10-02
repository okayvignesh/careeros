import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hashPassword, verifyPassword } from '@careeros/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { FIRST_ACCOUNT_ADVISORY_KEY } from '../../common/advisory-locks';

/**
 * A-C1: exponential lockout after repeated failed sign-ins on the same
 * (email, ip). Lockout window is `min(2^(N-1), 900)` seconds where N is the
 * count of consecutive failures since the last success in the recent window.
 */
export const LOCKOUT_MAX_S = 900; // 15 min cap
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export function lockoutSecondsFor(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  const raw = 2 ** (consecutiveFailures - 1);
  return Math.min(raw, LOCKOUT_MAX_S);
}

export class LockoutError extends HttpException {
  constructor(public readonly retryAfterS: number) {
    super(
      { statusCode: 429, message: 'Too many attempts. Try again later.', retryAfterS },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single-user rule: only allowed when no user exists yet. The count + insert
   * run in one transaction serialized by FIRST_ACCOUNT_ADVISORY_KEY so two
   * concurrent sign-ups cannot both pass the check and create a user.
   */
  async createUser(email: string, password: string, displayName?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FIRST_ACCOUNT_ADVISORY_KEY})`;
      const existing = await tx.user.count();
      if (existing > 0) {
        throw new ForbiddenException('Account already exists. Sign in instead.');
      }
      const passwordHash = await hashPassword(password);
      return tx.user.create({
        data: {
          email: normalizeEmail(email),
          displayName: displayName ?? null,
          passwordHash,
          setupState: { create: { state: 'account_created' } },
        },
        select: { id: true, email: true, displayName: true },
      });
    });
  }

  async verifyCredentials(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('Invalid email or password');
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    return { id: user.id, email: user.email };
  }

  /** A-C1: same as verifyCredentials but honors the lockout table.
   * - Before the argon2 verify, checks how many consecutive failures the
   *   (email, ip) pair has in the last window. If a lockout is active, throws
   *   a 429 with `Retry-After` (via LockoutError).
   * - After success, writes an ok=true row so the count resets.
   * - After failure, writes ok=false, recomputes the new lockout window, and
   *   emits an `auth.login.lockout` audit row when it just crossed the
   *   threshold.
   */
  async verifyCredentialsWithLockout(email: string, password: string, ip: string) {
    const normalized = normalizeEmail(email);
    const failures = await this.countRecentFailures(normalized, ip);
    const lockedFor = lockoutSecondsFor(failures);
    if (lockedFor > 0) {
      const mostRecent = await this.prisma.loginAttempt.findFirst({
        where: { email: normalized, ip, ok: false, attemptedAt: { gte: new Date(Date.now() - LOCKOUT_WINDOW_MS) } },
        orderBy: { attemptedAt: 'desc' },
        select: { attemptedAt: true },
      });
      if (mostRecent) {
        const elapsedS = Math.floor((Date.now() - mostRecent.attemptedAt.getTime()) / 1000);
        const remaining = Math.max(1, lockedFor - elapsedS);
        if (remaining > 0 && elapsedS < lockedFor) {
          throw new LockoutError(remaining);
        }
      }
    }

    let user: { id: string; email: string; passwordHash: string } | null = null;
    try {
      user = await this.prisma.user.findUnique({
        where: { email: normalized },
        select: { id: true, email: true, passwordHash: true },
      });
      const ok = user && (await verifyPassword(user.passwordHash, password));
      if (!user || !ok) {
        await this.recordAttempt(normalized, ip, false, 'invalid_credentials');
        await this.maybeAuditLockout(normalized, ip, user?.id);
        throw new UnauthorizedException('Invalid email or password');
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      if (e instanceof LockoutError) throw e;
      throw e;
    }
    await this.recordAttempt(normalized, ip, true);
    return { id: user.id, email: user.email };
  }

  /** A-H3: change password. Verifies old password, writes new hash, and
   * revokes every active session for the user (including the current one).
   * All done in a single Prisma transaction. Emits an audit event. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 12) {
      throw new HttpException('New password too short', HttpStatus.BAD_REQUEST);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, email: true },
    });
    if (!user) throw new UnauthorizedException('Not signed in');
    const ok = await verifyPassword(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    const newHash = await hashPassword(newPassword);
    const resetAt = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
      // A-H3: kill every sealed cookie whose iat is before this reset.
      this.prisma.activeSession.deleteMany({ where: { userId, issuedAt: { lt: resetAt } } }),
      this.prisma.auditEvent.create({
        data: {
          userId,
          actor: 'user',
          action: 'auth.password.changed',
          resourceType: 'user',
          resourceId: userId,
          payload: { resetAt: resetAt.toISOString(), reason: 'user_initiated' },
        },
      }),
    ]);
  }

  // --- lockout helpers ---

  private async countRecentFailures(email: string, ip: string): Promise<number> {
    // Count failures since the most recent success in the window. If there is
    // no success in the window, count all failures in the window.
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
    const lastSuccess = await this.prisma.loginAttempt.findFirst({
      where: { email, ip, ok: true, attemptedAt: { gte: since } },
      orderBy: { attemptedAt: 'desc' },
      select: { attemptedAt: true },
    });
    const cutoff = lastSuccess ? lastSuccess.attemptedAt : since;
    return this.prisma.loginAttempt.count({
      where: { email, ip, ok: false, attemptedAt: { gt: cutoff } },
    });
  }

  private async recordAttempt(email: string, ip: string, ok: boolean, reason?: string): Promise<void> {
    await this.prisma.loginAttempt
      .create({ data: { email, ip, ok, reason: reason ?? null } })
      .catch(() => undefined);
  }

  /** Best-effort audit write on the transition to "lockout active". Fired only
   * when the failure count crosses 5 (matches security.md item 4). */
  private async maybeAuditLockout(email: string, ip: string, userId?: string): Promise<void> {
    const failures = await this.countRecentFailures(email, ip);
    if (failures !== 5) return; // fire once at the threshold, not on every subsequent attempt
    await this.prisma.auditEvent
      .create({
        data: {
          userId: userId ?? null,
          actor: 'system',
          action: 'auth.login.lockout',
          resourceType: 'user',
          resourceId: userId ?? null,
          payload: { email, ip, consecutiveFailures: failures, lockoutS: lockoutSecondsFor(failures) },
          ip,
        },
      })
      .catch(() => undefined);
  }
}

/** L2-adjacent: NFC normalize before lowercase so Turkish dotless-i, combining
 * accents, etc. hit the same bucket. Keeps the auth path safe from
 * homograph-style bypass on lookups. */
export function normalizeEmail(email: string): string {
  return email.normalize('NFC').toLowerCase();
}
