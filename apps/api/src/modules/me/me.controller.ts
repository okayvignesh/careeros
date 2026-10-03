import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { clientIp } from '../../common/client-ip';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { MeService } from './me.service';
import { MasterKeyRotationService } from './master-key-rotation.service';

/**
 * F.8 (Wave F / P6): data-portability endpoints.
 *
 *   POST /me/export  auth + fresh re-auth (< 5 min)
 *                    Serializes a per-table JSON dump, age-encrypts it with
 *                    the operator's AGE_RECIPIENT public key, uploads to
 *                    MinIO under `exports/<userId>/<stamp>_export.json.age`,
 *                    and returns { url, manifest, encryptedBytes } where
 *                    `url` is a short-lived presigned GET.
 *
 *   POST /me/delete  auth + fresh re-auth + email confirmation
 *                    Body: { confirmEmail: "<user.email>" }
 *                    Wipes the User row (cascade removes user-owned rows;
 *                    SetNull unlinks audit-adjacent rows per F.6).
 *                    Returns 204.
 *
 *   POST /me/security/rotate-key  auth + fresh re-auth
 *                    Body: { newKey: "<64 hex or 44 base64>" }
 *                    Re-encrypts every encrypted_secret row + every
 *                    ENCRYPTED_FIELDS column from the running key to newKey,
 *                    one transaction per row. Returns the rotation progress
 *                    (counts + failure metadata, never secrets). The operator
 *                    swaps ENCRYPTION_KEY + restarts only after success.
 *
 * export/delete use the sealed-cookie age check below (mirrors
 * recovery.controller.ts + agent.controller.ts; TODO(C-P0.3): swap for shared
 * hasFreshReauth() when it lands). rotate-key already uses the shared
 * SensitivityGateService.hasFreshReauth in MasterKeyRotationService.
 */
const FRESH_REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly rotation: MasterKeyRotationService,
    private readonly session: SessionService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('export')
  @HttpCode(200)
  async exportSelf(@Req() req: Request) {
    const sealed = this.session.read(req);
    if (!sealed) throw new ForbiddenException('Not signed in');
    if (Date.now() - sealed.createdAt > FRESH_REAUTH_MAX_AGE_MS) {
      throw new ForbiddenException('Fresh re-authentication required');
    }
    const result = await this.me.exportToStorage(sealed.userId);
    await audit(this.prisma, sealed.userId, req, 'user.data.exported', {
      tables: result.manifest.tables.length,
      totalRows: result.manifest.tables.reduce((acc, t) => acc + t.rowCount, 0),
      schemaVersion: result.manifest.schemaVersion,
      key: result.key,
      encryptedBytes: result.encryptedBytes,
    });
    // The presigned URL expires in 5 min (StorageService.PRESIGN_TTL_SECONDS).
    // Manifest is returned alongside so the client can verify the download
    // byte-for-byte before decrypting.
    return {
      url: result.url,
      key: result.key,
      manifest: result.manifest,
      encryptedBytes: result.encryptedBytes,
    };
  }

  @Post('delete')
  @HttpCode(204)
  async deleteSelf(
    @Req() req: Request,
    @Body() body: { confirmEmail?: string },
  ) {
    const sealed = this.session.read(req);
    if (!sealed) throw new ForbiddenException('Not signed in');
    if (Date.now() - sealed.createdAt > FRESH_REAUTH_MAX_AGE_MS) {
      throw new ForbiddenException('Fresh re-authentication required');
    }
    if (!body?.confirmEmail || typeof body.confirmEmail !== 'string') {
      throw new BadRequestException('confirmEmail required');
    }
    // Compare against the actual email on file (case + NFC normalized both
    // sides, matches auth.service.normalizeEmail).
    const submitted = body.confirmEmail.normalize('NFC').toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { id: sealed.userId },
      select: { email: true },
    });
    if (!user || user.email.normalize('NFC').toLowerCase() !== submitted) {
      throw new ForbiddenException('confirmEmail does not match');
    }
    const { rowCounts } = await this.me.deleteUser(sealed.userId);
    // Best-effort: sessions/cookies for this user were cascade-deleted along
    // with everything else, so subsequent requests using the sealed cookie
    // will fail at SessionService.requireUserId (row lookup returns null).
    await audit(this.prisma, null, req, 'user.data.deleted', {
      userId: sealed.userId,
      rowCounts,
    });
    // Explicit `void` so nest's HttpCode 204 has no body per HTTP spec.
    void this.auth; // keep AuthService in the injected list for future
  }

  /**
   * Rotate the master ENCRYPTION_KEY. The service enforces fresh re-auth
   * (SensitivityGateService) and validates the new key's format before any
   * row is touched. A stopped run is reported as data, not an exception: the
   * operator keeps the old key and re-runs after fixing the reported row.
   */
  @Post('security/rotate-key')
  @HttpCode(200)
  async rotateMasterKey(
    @Req() req: Request,
    @Body() body: { newKey?: string },
  ) {
    const sealed = this.session.read(req);
    if (!sealed) throw new ForbiddenException('Not signed in');
    if (!body?.newKey || typeof body.newKey !== 'string') {
      throw new BadRequestException('newKey required');
    }
    const progress = await this.rotation.rotate({
      userId: sealed.userId,
      newKey: body.newKey,
    });
    await audit(
      this.prisma,
      sealed.userId,
      req,
      progress.stopped ? 'security.master_key.rotation_failed' : 'security.master_key.rotated',
      {
        scanned: progress.scanned,
        rotated: progress.rotated,
        alreadyRotated: progress.alreadyRotated,
        skippedPlaintext: progress.skippedPlaintext,
        failed: progress.failed,
        // Failure carries no ciphertext/plaintext, only source + id + message.
        failure: progress.failure,
      },
    );
    return progress;
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
        resourceType: 'user',
        resourceId: userId,
        payload: (payload ?? undefined) as never,
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512) || null,
      },
    })
    .catch(() => undefined);
}
