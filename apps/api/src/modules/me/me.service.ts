import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage.service';

/**
 * F.8: user-owned tables. If a table stores rows keyed to a userId, it lives
 * here. Export walks this list; parity assertions in the tests hit the same
 * list so a newly-added table can't silently escape either code path.
 *
 * A table using onDelete:SetNull (audit_log, llm_calls, llm_hallucination_log)
 * intentionally KEEPS the row after user delete with `userId=null` per the
 * audit-log immutability decision (F.6). Export includes them; delete-parity
 * asserts they are unlinked (userId IS NULL), not gone.
 *
 * ponytail: one array, one source of truth. If a new user-owned table lands,
 * add it here + write one adjacent test row and both export + delete + parity
 * pick it up automatically.
 */
export interface UserTable {
  /** Human name; goes into the export manifest + audit event. */
  readonly name: string;
  /** Prisma delegate name (matches the model, e.g. 'application'). */
  readonly delegate: keyof PrismaService;
  /** What happens on User delete. */
  readonly deleteBehavior: 'cascade' | 'set_null';
}

export const USER_TABLES: readonly UserTable[] = [
  { name: 'active_sessions', delegate: 'activeSession', deleteBehavior: 'cascade' },
  { name: 'agent_devices', delegate: 'agentDevice', deleteBehavior: 'cascade' },
  { name: 'agent_pairing_requests', delegate: 'agentPairingRequest', deleteBehavior: 'cascade' },
  { name: 'applications', delegate: 'application', deleteBehavior: 'cascade' },
  { name: 'approval_items', delegate: 'approvalItem', deleteBehavior: 'cascade' },
  { name: 'attempts', delegate: 'attempt', deleteBehavior: 'cascade' },
  { name: 'audit_events', delegate: 'auditEvent', deleteBehavior: 'set_null' },
  { name: 'boss_battles', delegate: 'bossBattle', deleteBehavior: 'cascade' },
  { name: 'candidate_skill_states', delegate: 'candidateSkillState', deleteBehavior: 'cascade' },
  { name: 'career_goals', delegate: 'careerGoal', deleteBehavior: 'cascade' },
  { name: 'cover_letters', delegate: 'coverLetter', deleteBehavior: 'cascade' },
  { name: 'daily_brief_preferences', delegate: 'dailyBriefPreference', deleteBehavior: 'cascade' },
  { name: 'email_application_links', delegate: 'emailApplicationLink', deleteBehavior: 'cascade' },
  { name: 'evidence', delegate: 'evidence', deleteBehavior: 'cascade' },
  { name: 'fact_base', delegate: 'factBase', deleteBehavior: 'cascade' },
  { name: 'gmail_processed_messages', delegate: 'gmailProcessedMessage', deleteBehavior: 'cascade' },
  { name: 'inbox_items', delegate: 'inboxItem', deleteBehavior: 'cascade' },
  { name: 'interview_prep', delegate: 'interviewPrep', deleteBehavior: 'cascade' },
  { name: 'ats_submissions', delegate: 'atsSubmission', deleteBehavior: 'cascade' },
  { name: 'outreach_messages', delegate: 'outreachMessage', deleteBehavior: 'cascade' },
  { name: 'gmail_watch', delegate: 'gmailWatch', deleteBehavior: 'cascade' },
  { name: 'integrations', delegate: 'integration', deleteBehavior: 'cascade' },
  { name: 'llm_calls', delegate: 'llmCall', deleteBehavior: 'set_null' },
  { name: 'llm_hallucination_log', delegate: 'llmHallucinationLog', deleteBehavior: 'set_null' },
  { name: 'market_briefs', delegate: 'marketBrief', deleteBehavior: 'cascade' },
  { name: 'market_snapshots', delegate: 'marketSnapshot', deleteBehavior: 'cascade' },
  { name: 'passkey_challenges', delegate: 'passkeyChallenge', deleteBehavior: 'cascade' },
  { name: 'passkey_credentials', delegate: 'passkeyCredential', deleteBehavior: 'cascade' },
  { name: 'provider_configs', delegate: 'providerConfig', deleteBehavior: 'cascade' },
  { name: 'recovery_codes', delegate: 'recoveryCode', deleteBehavior: 'cascade' },
  { name: 'recovery_keys', delegate: 'recoveryKey', deleteBehavior: 'cascade' },
  { name: 'remediation_tasks', delegate: 'remediationTask', deleteBehavior: 'cascade' },
  { name: 'resume_facts', delegate: 'resumeFact', deleteBehavior: 'cascade' },
  { name: 'resume_variants', delegate: 'resumeVariant', deleteBehavior: 'cascade' },
  { name: 'sessions', delegate: 'session', deleteBehavior: 'cascade' },
  { name: 'setup_state', delegate: 'setupStateRow', deleteBehavior: 'cascade' },
  { name: 'skill_facts', delegate: 'skillFact', deleteBehavior: 'cascade' },
  { name: 'skill_state_events', delegate: 'skillStateEvent', deleteBehavior: 'cascade' },
  { name: 'streaks', delegate: 'streak', deleteBehavior: 'cascade' },
  { name: 'user_job_preferences', delegate: 'userJobPreferences', deleteBehavior: 'cascade' },
  { name: 'xp_events', delegate: 'xpEvent', deleteBehavior: 'cascade' },
];

// Intentionally excluded from USER_TABLES:
//   - app_config, encrypted_secrets, normalized_jobs, jobs_raw, company_dossier,
//     skills, questions - global tables with no userId column.
//   - login_attempts - keyed by (email, ip); kept post-delete for lockout math
//     across possible re-registrations of the same email.
//   - agent_sessions, agent_tasks - keyed by deviceId; cascade via agent_devices.
//   - application_events - keyed by applicationId; cascade via applications.
//   - approval_events - keyed by approvalItemId; cascade via approval_items.

export interface ExportManifest {
  readonly userId: string;
  readonly email: string;
  readonly exportedAt: string;
  readonly schemaVersion: number;
  readonly tables: Array<{ name: string; rowCount: number; sha256: string }>;
}

export interface ExportPayload {
  readonly manifest: ExportManifest;
  readonly user: Record<string, unknown>;
  readonly tables: Record<string, unknown[]>;
}

/**
 * F.8 export format schema version. Bump when the manifest / payload layout
 * changes so downstream verifiers can gate on it.
 */
export const EXPORT_SCHEMA_VERSION = 1;

/**
 * F.8 follow-up: upload result returned by exportToStorage().
 * `url` is a short-lived (5 min, see StorageService.PRESIGN_TTL_SECONDS)
 * presigned GET for an age-encrypted artifact. `manifest` is the plaintext
 * table list + hashes so the client can verify the download byte-for-byte
 * before decryption.
 */
export interface ExportUploadResult {
  readonly key: string;
  readonly url: string;
  readonly manifest: ExportManifest;
  readonly encryptedBytes: number;
}

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Build the plaintext JSON export payload. Rows are queried with `findMany`
   * per USER_TABLES entry, hashed for the manifest, and returned as a single
   * object. Callers should normally use {@link exportToStorage} which handles
   * age-encryption + MinIO upload + presigned URL; this method is left public
   * for the test suite + CI parity jobs that need the plaintext structure.
   */
  async exportForUser(userId: string): Promise<ExportPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const tables: Record<string, unknown[]> = {};
    const manifestTables: ExportManifest['tables'] = [];

    for (const table of USER_TABLES) {
      const delegate = this.prisma[table.delegate] as unknown as {
        findMany: (args: { where: Record<string, unknown> }) => Promise<unknown[]>;
      };
      const rows = await delegate.findMany({ where: { userId } });
      const serialized = JSON.stringify(rows);
      tables[table.name] = rows;
      manifestTables.push({
        name: table.name,
        rowCount: rows.length,
        sha256: createHash('sha256').update(serialized).digest('hex'),
      });
    }

    const manifest: ExportManifest = {
      userId: user.id,
      email: user.email,
      exportedAt: new Date().toISOString(),
      schemaVersion: EXPORT_SCHEMA_VERSION,
      tables: manifestTables,
    };

    return { manifest, user, tables };
  }

  /**
   * F.8 follow-up: serialize the export payload, age-encrypt it with the
   * operator's public recipient key, upload to MinIO under
   * `exports/<userId>/<stamp>_export.json.age`, and return a short-lived
   * presigned GET URL plus the plaintext manifest.
   *
   * Why age via child_process: matches scripts/backup.sh exactly, no new npm
   * cipher dep, and the operator key material (AGE_RECIPIENT public key) is
   * already provisioned alongside the backup pipeline. See DEFERRED.md F.8.
   *
   * ponytail: whole payload is buffered then encrypted in one shot. Fine for
   * a single-user deployment where even an aggressive dump sits well under
   * 100 MB. Upgrade path when a dump outgrows memory: stream prisma results
   * through a Readable → age stdin → minio putObject with the stream variant.
   */
  async exportToStorage(userId: string): Promise<ExportUploadResult> {
    const recipient = process.env.AGE_RECIPIENT;
    if (!recipient || recipient.length === 0) {
      throw new Error(
        'AGE_RECIPIENT is required for /me/export (F.8). Set it to the operator age public key.',
      );
    }

    const payload = await this.exportForUser(userId);
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const encrypted = await ageEncrypt(plaintext, recipient);

    // Byte-check: age v1 ciphertext begins with the literal header
    // `age-encryption.org/v1\n`. Guard against a silent passthrough (missing
    // age binary that somehow exits 0 with plaintext on stdout).
    if (!encrypted.subarray(0, 21).equals(Buffer.from('age-encryption.org/v1'))) {
      throw new Error('age encryption produced output without the expected header');
    }

    const key = await this.storage.putExport(userId, encrypted);
    const url = await this.storage.presignExportDownload(userId, key);

    this.logger.log(
      `exported userId=${userId} tables=${payload.manifest.tables.length} ` +
        `encryptedBytes=${encrypted.length} key=${key}`,
    );

    return { key, url, manifest: payload.manifest, encryptedBytes: encrypted.length };
  }

  /**
   * Delete the User row. onDelete:Cascade removes all user-owned rows in one
   * txn; onDelete:SetNull nulls the userId on the three audit-adjacent tables
   * (F.6 kept these deliberately - immutable audit is a compliance requirement
   * that outranks GDPR-style purge for those rows).
   *
   * Returns the row-count snapshot taken BEFORE delete so the caller can
   * write it into the audit event and (in tests) compare to zero-after.
   */
  async deleteUser(userId: string): Promise<{ rowCounts: Record<string, number> }> {
    const rowCounts = await this.countUserRows(userId);
    await this.prisma.user.delete({ where: { id: userId } });
    return { rowCounts };
  }

  /**
   * Post-delete parity check. For every table:
   *   cascade tables MUST return 0 rows for this userId
   *   set_null tables MUST return 0 rows where userId=<id> (nulls don't match)
   * Exposed for tests + the CI restore-test job.
   */
  async assertDeletedForUser(userId: string): Promise<{ ok: boolean; nonZero: string[] }> {
    const rowCounts = await this.countUserRows(userId);
    const nonZero = Object.entries(rowCounts)
      .filter(([, count]) => count > 0)
      .map(([name]) => name);
    return { ok: nonZero.length === 0, nonZero };
  }

  private async countUserRows(userId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const table of USER_TABLES) {
      const delegate = this.prisma[table.delegate] as unknown as {
        count: (args: { where: Record<string, unknown> }) => Promise<number>;
      };
      out[table.name] = await delegate.count({ where: { userId } });
    }
    return out;
  }
}

/**
 * F.8 follow-up: pipe `plaintext` through `age -r <recipient>` and collect
 * the ciphertext from stdout. Mirrors the invocation in scripts/backup.sh so
 * the same operator key material decrypts both backups and user exports.
 *
 * ponytail: child_process spawn, not an npm cipher. The age binary ships on
 * every host that already runs backup.sh. Upgrade path if we ever want pure
 * JS: swap `age-encryption` (official JS port) under this same signature, no
 * caller changes.
 */
function ageEncrypt(plaintext: Buffer, recipient: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const bin = process.env.AGE_BIN ?? 'age';
    const proc = spawn(bin, ['-r', recipient], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    proc.on('error', (err) => reject(new Error(`age spawn failed: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        reject(new Error(`age exited ${code}: ${stderr || '(no stderr)'}`));
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });
    proc.stdin.write(plaintext);
    proc.stdin.end();
  });
}
