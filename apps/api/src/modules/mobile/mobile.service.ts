import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import type { MobileAuthPayload } from './mobile.types';

/**
 * B1 (phase 7 mobile): email/password sign-in that mints a JWT + rotating
 * refresh token for the native app. RN cannot read the web's sealed HttpOnly
 * cookie or its non-HttpOnly CSRF companion, so the mobile client uses the
 * same durable token shape as the desktop agent (device row + hashed session
 * row, revocation by DB lookup) but authenticates with credentials instead of
 * a device-code pairing handshake.
 *
 * The session/device rows reuse `agent_devices` + `agent_sessions` so the
 * existing Settings -> Devices revocation surface and the `AgentSession`
 * revocation authority apply unchanged (no schema change). Tokens carry the
 * `mobile:*` scope so they can never be replayed against `/agent/*` endpoints
 * and vice versa.
 *
 * ponytail: the mint/rotate/verify logic mirrors `AgentService` (~100 lines).
 * Extract a shared `DeviceSessionService` when a third device type lands;
 * right now the two token lifecycles differ enough (pairing code vs
 * credentials, separate scopes) that the shared surface would be the hashing
 * helpers only.
 */

export const MOBILE_JWT_SCOPE = 'mobile:*';
const JWT_TTL_S = 60 * 60; // 1 hour access token
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface MobileJwtClaims {
  sub: string; // deviceId
  userId: string;
  scope: string; // 'mobile:*'
  sid: string; // AgentSession.id
}

export interface MobileTokenPair {
  jwt: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface MobileSignInResult extends MobileTokenPair {
  deviceId: string;
  userId: string;
  email: string;
}

export interface SignInInput {
  email: string;
  password: string;
  ip: string;
  deviceName: string;
  platform?: string;
}

@Injectable()
export class MobileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Verify credentials (reusing the shared exponential lockout) and register a
   * device for the phone. The `publicKey` column is not-null and reserved for
   * a future device-keypair upgrade; mobile has no pairing handshake to carry
   * one, so we store a random 32-byte marker.
   */
  async signIn(input: SignInInput): Promise<MobileSignInResult> {
    const user = await this.auth.verifyCredentialsWithLockout(
      input.email,
      input.password,
      input.ip,
    );
    const device = await this.prisma.agentDevice.create({
      data: {
        userId: user.id,
        name: input.deviceName.slice(0, 128),
        platform: input.platform ? input.platform.slice(0, 64) : null,
        publicKey: new Uint8Array(randomBytes(32)),
      },
      select: { id: true, userId: true },
    });
    const minted = await this.mintSession(device.id, device.userId);
    return { deviceId: device.id, userId: device.userId, email: user.email, ...minted };
  }

  /**
   * Rotate the access + refresh token. The old session row is deleted in the
   * same transaction the new one is inserted, so a stolen refresh token can be
   * spent at most once.
   */
  async refresh(deviceId: string, refreshToken: string): Promise<MobileTokenPair & { deviceId: string }> {
    if (!refreshToken) throw new UnauthorizedException('refreshToken required');
    const refreshHash = sha256Hex(refreshToken);
    const row = await this.prisma.agentSession.findUnique({
      where: { refreshHash },
      select: { id: true, deviceId: true, revokedAt: true, expiresAt: true },
    });
    if (!row || row.deviceId !== deviceId) throw new UnauthorizedException('Invalid refresh token');
    if (row.revokedAt) throw new UnauthorizedException('Refresh token revoked');
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Refresh token expired');
    const device = await this.prisma.agentDevice.findUnique({
      where: { id: deviceId },
      select: { userId: true, revokedAt: true },
    });
    if (!device || device.revokedAt) throw new UnauthorizedException('Device revoked');
    const minted = await this.mintSession(deviceId, device.userId, row.id);
    return { deviceId, ...minted };
  }

  /**
   * Verify a `mobile:*` bearer JWT against the signature + expiry AND the
   * server-side session/device revocation state. Throws UnauthorizedException
   * on any failure so the middleware and controller share one code path.
   */
  async verifyBearer(token: string): Promise<MobileAuthPayload> {
    if (!token) throw new UnauthorizedException('Missing bearer token');
    let claims: MobileJwtClaims;
    try {
      claims = await this.jwt.verifyAsync<MobileJwtClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (claims.scope !== MOBILE_JWT_SCOPE) {
      throw new UnauthorizedException('Wrong token scope');
    }
    const jwtHash = sha256Hex(token);
    const row = await this.prisma.agentSession.findUnique({
      where: { jwtHash },
      select: {
        id: true,
        deviceId: true,
        revokedAt: true,
        expiresAt: true,
        device: { select: { userId: true, revokedAt: true } },
      },
    });
    if (!row || row.revokedAt) throw new UnauthorizedException('Session revoked');
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Session expired');
    if (row.device.revokedAt) throw new UnauthorizedException('Device revoked');
    if (
      row.deviceId !== claims.sub ||
      row.device.userId !== claims.userId ||
      row.id !== claims.sid
    ) {
      throw new UnauthorizedException('Token/session mismatch');
    }
    return { deviceId: row.deviceId, userId: row.device.userId, sessionId: row.id };
  }

  /**
   * Self-revoke: soft-delete the device and drop every session row so the
   * access token 401s on its next use. `userId` is enforced by the caller from
   * the verified token.
   */
  async revoke(deviceId: string, userId: string): Promise<void> {
    const device = await this.prisma.agentDevice.findUnique({
      where: { id: deviceId },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!device || device.userId !== userId) throw new UnauthorizedException('Device not found');
    if (device.revokedAt) return;
    await this.prisma.$transaction([
      this.prisma.agentDevice.update({
        where: { id: deviceId },
        data: { revokedAt: new Date() },
      }),
      this.prisma.agentSession.deleteMany({ where: { deviceId } }),
    ]);
  }

  private async mintSession(
    deviceId: string,
    userId: string,
    replaceSessionId?: string,
  ): Promise<MobileTokenPair> {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshHash = sha256Hex(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const claims: MobileJwtClaims = {
      sub: deviceId,
      userId,
      scope: MOBILE_JWT_SCOPE,
      sid: sessionId,
    };
    const jwt = await this.jwt.signAsync(claims, { expiresIn: JWT_TTL_S });
    const jwtHash = sha256Hex(jwt);
    await this.prisma.$transaction(async (tx) => {
      if (replaceSessionId) {
        await tx.agentSession.delete({ where: { id: replaceSessionId } });
      }
      await tx.agentSession.create({
        data: { id: sessionId, deviceId, jwtHash, refreshHash, expiresAt },
      });
    });
    return { jwt, refreshToken, expiresAt };
  }
}

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
