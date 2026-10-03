import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  assertStrongKey,
  isEncryptedField,
  loadMasterKey,
  rotateMasterKey,
} from '@careeros/secrets';
import { ENCRYPTED_FIELDS, PrismaService, prismaDelegateName } from '../../prisma/prisma.service';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';

/**
 * Fresh-re-auth op tag. The passkey / password re-verify path (C-P0.3) records
 * this window via `SensitivityGateService.withReauthWindow`; `rotate()` reads it
 * via `hasFreshReauth`. Rotation is irreversible-ish and touches every stored
 * credential, so it is always gated.
 */
export const ROTATE_MASTER_KEY_OP = 'security.rotate_master_key';

const MAX_FAILURE_MESSAGE = 300;

export interface RotationFailure {
  /** `EncryptedSecret` or the Prisma model name. Never contains ciphertext. */
  source: string;
  id: string;
  message: string;
}

export interface RotationProgress {
  /** Ciphertexts examined (encrypted secrets + encrypted field values). */
  scanned: number;
  rotated: number;
  /** Values the new key already decrypts — safe resume after a partial run. */
  alreadyRotated: number;
  /** Legacy field values with no `enc:v1:` marker (left untouched). */
  skippedPlaintext: number;
  failed: number;
  /** True when the walk stopped at the first failure. */
  stopped: boolean;
  failure: RotationFailure | null;
}

/** Structural view of a dynamically-selected model delegate on the raw client. */
interface RawFieldDelegate {
  findMany(args: {
    select: Record<string, boolean>;
  }): Promise<Array<Record<string, unknown>>>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<unknown>;
}

/**
 * Rotates the master `ENCRYPTION_KEY`: decrypt every `encrypted_secrets` row
 * and every `enc:`-prefixed `ENCRYPTED_FIELDS` column with the old key,
 * re-encrypt with the new key, one transaction per row.
 *
 * Failure model: stop at the first row that neither key can decrypt and report
 * it. The operator therefore keeps the old key in `ENCRYPTION_KEY` (the service
 * never mutates env). Successfully rotated rows are on the new key, and because
 * `rotateMasterKey` is idempotent a re-run skips them and resumes — so the
 * operator re-runs after fixing the reported row. `onProgress` fires after
 * every row so a caller can surface a live count.
 *
 * Secrets are never returned: progress carries counts and `{source,id,message}`
 * only.
 */
@Injectable()
export class MasterKeyRotationService {
  private readonly logger = new Logger(MasterKeyRotationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gate: SensitivityGateService,
  ) {}

  /**
   * Fresh-re-auth-gated entrypoint. Validates the operator-supplied new key
   * (format + known-weak set) before doing any work.
   */
  async rotate(input: {
    userId: string;
    newKey: string;
    onProgress?: (progress: RotationProgress) => void;
  }): Promise<RotationProgress> {
    if (!this.gate.hasFreshReauth(input.userId, ROTATE_MASTER_KEY_OP)) {
      throw new ForbiddenException('Fresh re-authentication required');
    }
    assertStrongKey('ENCRYPTION_KEY', input.newKey);
    const newKey = loadMasterKey(input.newKey);
    const oldKey = loadMasterKey();
    return this.rotateWithKeys(oldKey, newKey, input.onProgress);
  }

  /** Lower-level walk with explicit keys (unit-testable without env/DI). */
  async rotateWithKeys(
    oldKey: Buffer,
    newKey: Buffer,
    onProgress?: (progress: RotationProgress) => void,
  ): Promise<RotationProgress> {
    const raw = this.prisma.rawClient;
    const progress: RotationProgress = {
      scanned: 0,
      rotated: 0,
      alreadyRotated: 0,
      skippedPlaintext: 0,
      failed: 0,
      stopped: false,
      failure: null,
    };
    const report = (): void => onProgress?.({ ...progress });

    const secrets = await raw.encryptedSecret.findMany({
      select: { id: true, purpose: true, ciphertext: true },
    });
    for (const row of secrets) {
      progress.scanned++;
      try {
        const result = rotateMasterKey(oldKey, newKey, {
          kind: 'secret',
          ciphertext: row.ciphertext,
          context: row.purpose,
        });
        if (result.status === 'rotated') {
          await raw.$transaction(async (tx) => {
            await tx.encryptedSecret.update({
              where: { id: row.id },
              data: { ciphertext: result.ciphertext },
            });
          });
          progress.rotated++;
        } else {
          progress.alreadyRotated++;
        }
      } catch (err) {
        return this.fail(progress, 'EncryptedSecret', row.id, err, report);
      }
      report();
    }

    for (const [model, specs] of Object.entries(ENCRYPTED_FIELDS)) {
      const delegateName = prismaDelegateName(model);
      for (const spec of specs) {
        const delegate = (raw as unknown as Record<string, RawFieldDelegate>)[delegateName];
        const rows = await delegate.findMany({
          select: { id: true, [spec.column]: true },
        });
        for (const row of rows) {
          const value = row[spec.column];
          if (typeof value !== 'string' || !isEncryptedField(value)) {
            progress.skippedPlaintext++;
            continue;
          }
          progress.scanned++;
          try {
            const result = rotateMasterKey(oldKey, newKey, {
              kind: 'field',
              ciphertext: value,
              context: spec.column,
            });
            if (result.status === 'rotated') {
              const id = String(row.id);
              await raw.$transaction(async (tx) => {
                const txDelegate = (tx as unknown as Record<string, RawFieldDelegate>)[
                  delegateName
                ];
                await txDelegate.update({
                  where: { id },
                  data: { [spec.column]: result.ciphertext },
                });
              });
              progress.rotated++;
            } else {
              progress.alreadyRotated++;
            }
          } catch (err) {
            return this.fail(progress, model, String(row.id), err, report);
          }
          report();
        }
      }
    }

    report();
    return progress;
  }

  private fail(
    progress: RotationProgress,
    source: string,
    id: string,
    err: unknown,
    report: () => void,
  ): RotationProgress {
    progress.failed++;
    progress.stopped = true;
    progress.failure = {
      source,
      id,
      message: (err instanceof Error ? err.message : String(err)).slice(0, MAX_FAILURE_MESSAGE),
    };
    this.logger.error(
      `master-key rotation stopped at ${source}/${id}: ${progress.failure.message}`,
    );
    report();
    return progress;
  }
}
