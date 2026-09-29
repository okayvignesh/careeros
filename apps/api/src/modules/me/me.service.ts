import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

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
  { name: 'evidence', delegate: 'evidence', deleteBehavior: 'cascade' },
  { name: 'fact_base', delegate: 'factBase', deleteBehavior: 'cascade' },
  { name: 'gmail_processed_messages', delegate: 'gmailProcessedMessage', deleteBehavior: 'cascade' },
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

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the JSON export payload. MVP: returned inline in the response body
   * (no MinIO, no age encryption). Rows are queried with `findMany` per
   * table, hashed for the manifest, and returned.
   *
   * ponytail: JSON in-response scales fine for a single-user deployment.
   * Upgrade path when needed: stream to MinIO + presign the URL + age-encrypt
   * with the recovery key. See DEFERRED.md F.8 note.
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
