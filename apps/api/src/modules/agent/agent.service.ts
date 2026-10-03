import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D.2 (Wave D / P3.5): backend orchestration for the desktop-agent pairing +
 * JWT + WSS surface. The service owns:
 *
 *   - pairing-code mint / verify (6-digit numeric, 10 min TTL, single-use);
 *   - agent-device creation + JWT/refresh mint on completion;
 *   - refresh rotation (delete old row, insert new one, same tx);
 *   - device revocation (soft delete on `revokedAt` + drop AgentSession rows);
 *   - task-result reception (mark AgentTask completed/failed + resultJson).
 *
 * Ponytail: `@nestjs/jwt` handles sign/verify; the server-side AgentSession
 * table is the revocation authority (compare sha256(jwt) against `jwtHash`).
 * All secrets read from env at construction time.
 */

export const AGENT_JWT_SCOPE = 'agent:*';
const JWT_TTL_S = 60 * 60; // 1 hour access token
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 min
const TASK_TTL_MS = 30 * 60 * 1000; // 30 min default expiry for queued tasks

export interface AgentJwtClaims {
  sub: string; // deviceId
  userId: string;
  scope: string; // 'agent:*'
  sid: string; // AgentSession.id (for revoke lookup)
}

export interface PairStartResult {
  code: string;
  pairingRequestId: string;
  expiresAt: Date;
}

export interface PairCompleteResult {
  deviceId: string;
  jwt: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Emitted after a terminal task result is persisted. Lets the approval worker
 * (A2) map an AgentTask back to the approval item that dispatched it without
 * coupling AgentService to the approvals module.
 */
export interface AgentTaskResultEvent {
  taskId: string;
  deviceId: string;
  status: 'completed' | 'failed' | 'timeout';
  resultJson: unknown;
}

export interface AgentTaskResultListener {
  onTaskResult(event: AgentTaskResultEvent): Promise<void> | void;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly resultListeners: AgentTaskResultListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Consumer hook: called once per persisted terminal task result. */
  registerResultListener(listener: AgentTaskResultListener): void {
    this.resultListeners.push(listener);
  }

  /**
   * Mint a fresh 6-digit pairing code for `userId`. Invalidates any prior
   * unconsumed request for the same user in the same tx (spec: second call
   * within TTL invalidates first).
   */
  async pairStart(userId: string): Promise<PairStartResult> {
    const code = randomSixDigit();
    const codeHash = sha256Hex(code);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    // Delete any prior unconsumed request for this user so only one is live.
    const [, created] = await this.prisma.$transaction([
      this.prisma.agentPairingRequest.deleteMany({
        where: { userId, consumedAt: null },
      }),
      this.prisma.agentPairingRequest.create({
        data: { userId, codeHash, expiresAt },
        select: { id: true, expiresAt: true },
      }),
    ]);
    return { code, pairingRequestId: created.id, expiresAt: created.expiresAt };
  }

  /**
   * Consume a pairing code + register a new device. Returns the JWT +
   * refresh token; both are single-use for their scope (refresh rotates on
   * every /pair/refresh). On success emits `agent.pair.completed`; on failure
   * the caller emits `agent.pair.failed`.
   */
  async pairComplete(
    code: string,
    deviceName: string,
    publicKey: Buffer,
    agentVersion?: string,
    platform?: string,
  ): Promise<PairCompleteResult> {
    if (!code || !/^\d{6}$/.test(code)) {
      throw new UnauthorizedException('Invalid pairing code');
    }
    if (!deviceName || deviceName.length > 128) {
      throw new BadRequestException('deviceName required (<=128 chars)');
    }
    if (!publicKey || publicKey.length === 0 || publicKey.length > 4096) {
      throw new BadRequestException('publicKey required');
    }
    const codeHash = sha256Hex(code);
    // Atomic compare-and-set on consumedAt: exactly one caller can spend it.
    const now = new Date();
    const spent = await this.prisma.agentPairingRequest.updateMany({
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (spent.count !== 1) {
      throw new UnauthorizedException('Invalid pairing code');
    }
    const req = await this.prisma.agentPairingRequest.findUnique({
      where: { codeHash },
      select: { userId: true },
    });
    if (!req) throw new UnauthorizedException('Invalid pairing code');
    const device = await this.prisma.agentDevice.create({
      data: {
        userId: req.userId,
        name: deviceName.slice(0, 128),
        platform: platform?.slice(0, 64) ?? null,
        publicKey: new Uint8Array(publicKey),
        agentVersion: agentVersion ?? null,
      },
      select: { id: true, userId: true },
    });
    const minted = await this.mintSession(device.id, device.userId);
    return {
      deviceId: device.id,
      jwt: minted.jwt,
      refreshToken: minted.refreshToken,
      expiresAt: minted.expiresAt,
    };
  }

  /**
   * Rotate the JWT + refresh for a device. Requires a currently-live
   * refresh token (compared by sha256). Deletes the old AgentSession row
   * and inserts a new one in one tx so a stolen refresh token cannot be
   * used twice.
   */
  async pairRefresh(deviceId: string, refreshToken: string): Promise<PairCompleteResult> {
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
    // Rotate: drop the old row, mint a new one.
    const minted = await this.mintSession(deviceId, device.userId, row.id);
    return {
      deviceId,
      jwt: minted.jwt,
      refreshToken: minted.refreshToken,
      expiresAt: minted.expiresAt,
    };
  }

  /**
   * Soft-revoke a device: mark `agent_devices.revokedAt` and delete every
   * AgentSession row so any subsequent JWT-authed request 401s and the WSS
   * connection is dropped by the gateway on next verify. `userId` is
   * enforced by the caller (session auth) — an agent revoking itself via
   * JWT skips the ownership check and passes null.
   */
  async revokeDevice(deviceId: string, userId: string | null): Promise<void> {
    const device = await this.prisma.agentDevice.findUnique({
      where: { id: deviceId },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!device) throw new NotFoundException('Device not found');
    if (userId && device.userId !== userId) throw new NotFoundException('Device not found');
    if (device.revokedAt) return;
    await this.prisma.$transaction([
      this.prisma.agentDevice.update({
        where: { id: deviceId },
        data: { revokedAt: new Date() },
      }),
      this.prisma.agentSession.deleteMany({ where: { deviceId } }),
    ]);
  }

  async listDevices(userId: string) {
    return this.prisma.agentDevice.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        platform: true,
        pairedAt: true,
        revokedAt: true,
        lastSeenAt: true,
        agentVersion: true,
      },
      orderBy: { pairedAt: 'desc' },
    });
  }

  /**
   * Verify a bearer JWT against `@nestjs/jwt` (signature + exp) AND against
   * the server-side AgentSession row (revocation). Returns the deviceId +
   * userId on success. Thrown UnauthorizedException on any failure so
   * controllers + the WSS gateway share one code path.
   */
  async verifyBearer(token: string): Promise<{ deviceId: string; userId: string; sessionId: string }> {
    if (!token) throw new UnauthorizedException('Missing bearer token');
    let claims: AgentJwtClaims;
    try {
      claims = await this.jwt.verifyAsync<AgentJwtClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (claims.scope !== AGENT_JWT_SCOPE) {
      throw new UnauthorizedException('Wrong token scope');
    }
    const jwtHash = sha256Hex(token);
    const row = await this.prisma.agentSession.findUnique({
      where: { jwtHash },
      select: { id: true, deviceId: true, revokedAt: true, expiresAt: true, device: { select: { userId: true, revokedAt: true } } },
    });
    if (!row || row.revokedAt) throw new UnauthorizedException('Session revoked');
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Session expired');
    if (row.device.revokedAt) throw new UnauthorizedException('Device revoked');
    if (row.deviceId !== claims.sub || row.device.userId !== claims.userId || row.id !== claims.sid) {
      throw new UnauthorizedException('Token/session mismatch');
    }
    return { deviceId: row.deviceId, userId: row.device.userId, sessionId: row.id };
  }

  /**
   * Called by the JWT-authed task-result endpoint: record the result +
   * transition the task. `deviceId` MUST match the row so a compromised
   * device cannot post results for another device's task.
   */
  async recordTaskResult(
    taskId: string,
    deviceId: string,
    status: 'completed' | 'failed' | 'timeout',
    resultJson: unknown,
  ): Promise<void> {
    if (status !== 'completed' && status !== 'failed' && status !== 'timeout') {
      throw new BadRequestException('Invalid status');
    }
    const now = new Date();
    const updated = await this.prisma.agentTask.updateMany({
      where: { id: taskId, deviceId, status: { in: ['queued', 'in_progress'] } },
      data: { status, completedAt: now, resultJson: (resultJson ?? null) as never },
    });
    if (updated.count !== 1) throw new NotFoundException('Task not found or already terminal');
    // Fire-and-forget: the approval worker (A2) owns the terminal approval
    // transition; a listener failure must not fail the device's HTTP result
    // post (which already succeeded).
    for (const listener of this.resultListeners) {
      void Promise.resolve(listener.onTaskResult({ taskId, deviceId, status, resultJson })).catch(
        (err: unknown) => {
          this.logger.error(`task-result listener failed for ${taskId}: ${(err as Error).message}`);
        },
      );
    }
  }

  /** Bump `lastSeenAt` on the device row. Used by WSS gateway on connect + heartbeat. */
  async touchDevice(deviceId: string, agentVersion?: string): Promise<void> {
    await this.prisma.agentDevice
      .update({
        where: { id: deviceId },
        data: {
          lastSeenAt: new Date(),
          ...(agentVersion ? { agentVersion } : {}),
        },
      })
      .catch(() => undefined);
  }

  // --- private ---

  /**
   * Mint (jwt, refreshToken) + persist their hashes in AgentSession. When
   * `replaceSessionId` is passed the old row is deleted in the same tx
   * (refresh rotation).
   */
  private async mintSession(
    deviceId: string,
    userId: string,
    replaceSessionId?: string,
  ): Promise<{ jwt: string; refreshToken: string; expiresAt: Date }> {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshHash = sha256Hex(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const claims: AgentJwtClaims = {
      sub: deviceId,
      userId,
      scope: AGENT_JWT_SCOPE,
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

// --- helpers ---

function randomSixDigit(): string {
  // Reject-and-retry against modulo bias on a byte pool: 0..999999 fits in
  // 20 bits, so draw 3 bytes and keep only values < 16_777_216 - (2^24 mod 10^6).
  const N = 1_000_000;
  const MAX = Math.floor(0x1_00_00_00 / N) * N;
  while (true) {
    const b = randomBytes(3);
    const v = (b[0] << 16) | (b[1] << 8) | b[2];
    if (v < MAX) return String(v % N).padStart(6, '0');
  }
}

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
