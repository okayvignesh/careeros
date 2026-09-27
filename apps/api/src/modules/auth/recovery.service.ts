import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from './session.service';
import { normalizeEmail } from './auth.service';

/**
 * C-P0.7: one-time recovery codes for account access when passkeys are lost.
 *
 *  - `generateCodes(userId, count=8)` returns plaintext codes ONCE and
 *    persists only sha256 hashes. Any previously unused codes are wiped so
 *    the "regenerate" UX gives the user a clean set (matches how Google /
 *    GitHub handle regeneration).
 *  - `redeemCode(email, code)` normalizes the input (uppercase, strip
 *    hyphens/whitespace), hashes, and atomically marks the row used. On
 *    success it mints a session via SessionService.
 *
 * Codes are 12 alphanumeric chars from an unambiguous alphabet
 * (Crockford-ish: no I/L/O/U/0/1) rendered as `xxxx-xxxx-xxxx`. That gives
 * ~62 bits of entropy per code — well past guessing under any realistic
 * rate limit.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // 30 chars, ambiguous ones dropped
const CODE_LEN = 12; // 3 groups of 4

@Injectable()
export class RecoveryCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
  ) {}

  /**
   * Generate + persist a fresh set of `count` codes. Returns the plaintext
   * codes to display exactly once. Wipes any prior unused codes so the user
   * has one active set at a time.
   */
  async generateCodes(userId: string, count = 8): Promise<{ codes: string[] }> {
    const codes: string[] = [];
    const seen = new Set<string>();
    while (codes.length < count) {
      const c = randomCode();
      if (seen.has(c)) continue;
      seen.add(c);
      codes.push(c);
    }
    const rows = codes.map((c) => ({ userId, codeHash: hashCode(c) }));
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId, usedAt: null } }),
      this.prisma.recoveryCode.createMany({ data: rows }),
    ]);
    return { codes: codes.map(formatForDisplay) };
  }

  /**
   * Redeem a code by (email, code). Returns the userId + writes a session
   * cookie via SessionService on success. Atomic on usedAt — a code can be
   * spent exactly once even under concurrent redemption.
   */
  async redeemCode(
    email: string,
    code: string,
    res: Response,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<{ userId: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true },
    });
    if (!user) throw new UnauthorizedException('Invalid recovery code');
    const hash = hashCode(code);
    // Atomic compare-and-set: only marks used if usedAt is still null AND the
    // hash belongs to this user. `updateMany` returns count so we know
    // whether we spent it.
    const now = new Date();
    const updated = await this.prisma.recoveryCode.updateMany({
      where: { userId: user.id, codeHash: hash, usedAt: null },
      data: { usedAt: now },
    });
    if (updated.count !== 1) {
      throw new UnauthorizedException('Invalid recovery code');
    }
    await this.session.write(res, user.id, meta);
    return { userId: user.id };
  }

  /** Count of remaining (unused) codes — cheap UX signal for the settings page. */
  async remainingForUser(userId: string): Promise<number> {
    return this.prisma.recoveryCode.count({ where: { userId, usedAt: null } });
  }
}

// --- helpers ---

function randomCode(): string {
  // Reject-and-retry against modulo bias: draw a byte, keep only values that
  // fit an exact multiple of ALPHABET length.
  const N = CODE_ALPHABET.length; // 30
  const MAX = Math.floor(256 / N) * N; // 240
  const out: string[] = [];
  while (out.length < CODE_LEN) {
    const b = randomBytes(1)[0];
    if (b >= MAX) continue;
    out.push(CODE_ALPHABET[b % N]);
  }
  return out.join('');
}

/** Case-insensitive normalization: uppercase, strip hyphens + whitespace. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

function hashCode(input: string): string {
  return createHash('sha256').update(normalizeCode(input)).digest('hex');
}

function formatForDisplay(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}
