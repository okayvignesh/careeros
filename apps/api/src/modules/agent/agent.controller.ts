import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { clientIp } from '../../common/client-ip';
import { SessionService } from '../auth/session.service';
import { AgentService } from './agent.service';
import { AgentJwtGuard } from './agent.jwt-strategy';

/**
 * D.2 (Wave D / P3.5): endpoints for the desktop-agent pairing + JWT + WSS
 * surface. Auth model:
 *
 *   - Session cookie (browser) for `pair/start`, `GET /devices`,
 *     `DELETE /devices/:id`, and `POST /pair/revoke` (device revoke via UI).
 *   - JWT bearer (desktop) for `pair/refresh`, `tasks/:id/result`, and
 *     `POST /pair/revoke` (agent revoking itself).
 *   - Public (no auth) for `POST /pair/complete` — the desktop agent has no
 *     cookies yet, so pairing is bootstrapped by the shared 6-digit code
 *     the user copies into the desktop UI. Rate-limited 5/hr per IP.
 *
 * Fresh re-auth: `pair/start` requires the browser session's `createdAt` to
 * be < 5 min old (mirrors recovery.controller.ts pattern). TODO(C-P0.3):
 * swap for shared hasFreshReauth() when it lands.
 */
const FRESH_REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agents: AgentService,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('pair/start')
  @HttpCode(200)
  // 3/min per IP — user-driven UI action; deliberately low.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async pairStart(@Req() req: Request) {
    const sealed = this.session.read(req);
    if (!sealed) throw new ForbiddenException('Not signed in');
    const age = Date.now() - sealed.createdAt;
    if (age > FRESH_REAUTH_MAX_AGE_MS) {
      throw new ForbiddenException('Fresh re-authentication required');
    }
    try {
      const out = await this.agents.pairStart(sealed.userId);
      await audit(this.prisma, sealed.userId, req, 'agent.pair.started', {
        pairingRequestId: out.pairingRequestId,
        expiresAt: out.expiresAt.toISOString(),
      });
      return {
        code: out.code,
        pairingRequestId: out.pairingRequestId,
        expiresAt: out.expiresAt.toISOString(),
      };
    } catch (e) {
      await audit(this.prisma, sealed.userId, req, 'agent.pair.failed', {
        phase: 'start',
        reason: (e as Error).message,
      });
      throw e;
    }
  }

  @Post('pair/complete')
  @HttpCode(200)
  // Spec: 5/hr per IP on the public pair-complete endpoint.
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  async pairComplete(
    @Req() req: Request,
    @Body() body: { code?: string; deviceName?: string; publicKey?: string; agentVersion?: string },
  ) {
    if (!body?.code || !body?.deviceName || !body?.publicKey) {
      await audit(this.prisma, null, req, 'agent.pair.failed', { phase: 'complete', reason: 'missing_fields' });
      throw new ForbiddenException('code, deviceName, publicKey required');
    }
    let publicKey: Buffer;
    try {
      publicKey = Buffer.from(body.publicKey, 'base64');
    } catch {
      await audit(this.prisma, null, req, 'agent.pair.failed', { phase: 'complete', reason: 'bad_public_key' });
      throw new ForbiddenException('publicKey must be base64');
    }
    try {
      const out = await this.agents.pairComplete(
        body.code,
        body.deviceName,
        publicKey,
        body.agentVersion,
      );
      await audit(this.prisma, null, req, 'agent.pair.completed', {
        deviceId: out.deviceId,
        agentVersion: body.agentVersion ?? null,
      });
      return {
        deviceId: out.deviceId,
        jwt: out.jwt,
        refreshToken: out.refreshToken,
        expiresAt: out.expiresAt.toISOString(),
      };
    } catch (e) {
      await audit(this.prisma, null, req, 'agent.pair.failed', {
        phase: 'complete',
        reason: (e as Error).message,
      });
      throw e;
    }
  }

  @Post('pair/refresh')
  @HttpCode(200)
  @UseGuards(AgentJwtGuard)
  async pairRefresh(
    @Req() req: Request,
    @Body() body: { refreshToken?: string },
  ) {
    const deviceId = req.agent!.deviceId;
    if (!body?.refreshToken) throw new ForbiddenException('refreshToken required');
    const out = await this.agents.pairRefresh(deviceId, body.refreshToken);
    await audit(this.prisma, req.agent!.userId, req, 'agent.jwt.refreshed', {
      deviceId,
      expiresAt: out.expiresAt.toISOString(),
    });
    return {
      deviceId: out.deviceId,
      jwt: out.jwt,
      refreshToken: out.refreshToken,
      expiresAt: out.expiresAt.toISOString(),
    };
  }

  /**
   * Revoke a device. Accepts either a valid session cookie (user revoking
   * a device from settings — body.deviceId required) OR a valid agent JWT
   * (agent revoking itself — uses the JWT's deviceId).
   */
  @Post('pair/revoke')
  @HttpCode(204)
  async pairRevoke(@Req() req: Request, @Body() body: { deviceId?: string }) {
    const sealed = this.session.read(req);
    const header = req.headers.authorization ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (sealed) {
      const deviceId = body?.deviceId;
      if (!deviceId) throw new ForbiddenException('deviceId required');
      await this.agents.revokeDevice(deviceId, sealed.userId);
      await audit(this.prisma, sealed.userId, req, 'agent.device.revoked', { deviceId, by: 'user' });
      return;
    }
    if (bearer) {
      const verified = await this.agents.verifyBearer(bearer);
      await this.agents.revokeDevice(verified.deviceId, null);
      await audit(this.prisma, verified.userId, req, 'agent.device.revoked', {
        deviceId: verified.deviceId,
        by: 'agent',
      });
      return;
    }
    throw new ForbiddenException('Not signed in');
  }

  @Get('devices')
  @HttpCode(200)
  async listDevices(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.agents.listDevices(userId);
  }

  @Delete('devices/:id')
  @HttpCode(204)
  async deleteDevice(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    await this.agents.revokeDevice(id, userId);
    await audit(this.prisma, userId, req, 'agent.device.revoked', { deviceId: id, by: 'user' });
  }

  /**
   * Agent posts the result of a task assigned to it. `status` in
   * ('completed' | 'failed' | 'timeout'); the row transitions from
   * queued/in_progress to terminal and stores `resultJson`. Only the
   * device that owns the task can post its result.
   */
  @Post('tasks/:id/result')
  @HttpCode(204)
  @UseGuards(AgentJwtGuard)
  async postTaskResult(
    @Req() req: Request,
    @Param('id') taskId: string,
    @Body() body: { status?: string; resultJson?: unknown },
  ) {
    const deviceId = req.agent!.deviceId;
    const status = body?.status;
    if (status !== 'completed' && status !== 'failed' && status !== 'timeout') {
      throw new ForbiddenException('status must be completed|failed|timeout');
    }
    await this.agents.recordTaskResult(taskId, deviceId, status, body?.resultJson ?? null);
    await this.agents.touchDevice(deviceId);
    await audit(this.prisma, req.agent!.userId, req, 'agent.task.result.received', {
      taskId,
      deviceId,
      status,
    });
  }
}

async function audit(
  prisma: PrismaService,
  userId: string | null,
  req: Request,
  action: string,
  payload: Record<string, unknown> | null,
): Promise<void> {
  await prisma.auditEvent
    .create({
      data: {
        userId,
        actor: userId ? 'user' : 'system',
        action,
        resourceType: 'agent_device',
        resourceId: null,
        payload: (payload ?? undefined) as never,
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512) || null,
      },
    })
    .catch(() => undefined);
}
