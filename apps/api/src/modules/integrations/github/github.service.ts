import { Injectable, BadRequestException } from '@nestjs/common';
import { encrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../../common/queue.service';

const KEY = loadMasterKey();
const PURPOSE = 'integration:github:token';
const GITHUB_API = 'https://api.github.com';

// Classic-PAT scope policy for A-H6. Anything outside `ALLOWED` (or in `BLOCKED`)
// is rejected before we ever persist the token. `BLOCKED` lists the specific
// high-blast-radius scopes we want a hard-fail message for; anything else that
// isn't in `ALLOWED` gets the same reject with a generic message.
const ALLOWED_SCOPES = new Set(['repo', 'public_repo', 'read:user', 'user:email']);
const BLOCKED_SCOPES = new Set([
  'admin:org',
  'admin:repo_hook',
  'admin:public_key',
  'admin:enterprise',
  'admin:gpg_key',
  'delete_repo',
  'workflow',
  'write:packages',
  'delete:packages',
  'write:discussion',
]);

export interface GithubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  publicRepos: number;
  followers: number;
}

// Thrown when the PAT the user pasted carries scopes we refuse to persist. Kept
// as its own type so callers (controllers, tests) can distinguish "bad scope"
// from "token dead" or "GitHub down".
export class InvalidTokenScopeError extends BadRequestException {
  constructor(
    public readonly reason: string,
    public readonly offendingScopes: string[] = [],
  ) {
    super({ message: reason, offendingScopes });
  }
}

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async saveToken(userId: string, token: string): Promise<GithubProfile> {
    // Validate the token FIRST: fetchUser both proves the token is live and
    // reads `x-oauth-scopes` so we can reject over-scoped PATs before persist.
    // Any throw here means NO DB write, NO sync enqueue.
    const profile = await this.fetchUser(userId, token);

    const ciphertext = encrypt(token, KEY, PURPOSE);
    const secret = await this.prisma.encryptedSecret.upsert({
      where: {
        ownerType_ownerId_purpose: { ownerType: 'user', ownerId: userId, purpose: PURPOSE },
      },
      create: { ownerType: 'user', ownerId: userId, purpose: PURPOSE, ciphertext },
      update: { ciphertext },
    });

    await this.prisma.integration.upsert({
      where: { userId_kind: { userId, kind: 'github' } },
      create: {
        userId,
        kind: 'github',
        status: 'connected',
        tokenSecretId: secret.id,
        metadata: profile as unknown as object,
      },
      update: {
        status: 'connected',
        tokenSecretId: secret.id,
        metadata: profile as unknown as object,
      },
    });

    // Kick off the first repo sync in the background. Wizard doesn't wait for it.
    // Only reachable after fetchUser + scope-gate above have accepted the token.
    await this.queue.enqueueGithubSync({ userId, reason: 'setup' });

    return profile;
  }

  async resync(userId: string, reason: 'manual' | 'scheduled' = 'manual'): Promise<void> {
    await this.queue.enqueueGithubSync({ userId, reason });
  }

  async disconnect(userId: string): Promise<void> {
    await this.prisma.integration.update({
      where: { userId_kind: { userId, kind: 'github' } },
      data: { status: 'revoked', tokenSecretId: null },
    });
  }

  async getConnection(userId: string) {
    return this.prisma.integration.findUnique({
      where: { userId_kind: { userId, kind: 'github' } },
    });
  }

  async getContributions(userId: string): Promise<{
    totalContributions: number;
    weeks: Array<{ firstDay: string; days: Array<{ date: string; count: number; level: 0 | 1 | 2 | 3 | 4; weekday: number }> }>;
    updatedAt: string | null;
    login: string | null;
  } | null> {
    const row = await this.prisma.integration.findUnique({
      where: { userId_kind: { userId, kind: 'github' } },
      select: { metadata: true, status: true },
    });
    if (!row || row.status !== 'connected' || !row.metadata) return null;
    const meta = row.metadata as Record<string, unknown>;
    const calendar = meta.contributions as
      | {
          totalContributions: number;
          weeks: Array<{
            firstDay: string;
            days: Array<{ date: string; count: number; level: 0 | 1 | 2 | 3 | 4; weekday: number }>;
          }>;
        }
      | undefined;
    if (!calendar) return null;
    return {
      totalContributions: calendar.totalContributions,
      weeks: calendar.weeks,
      updatedAt: (meta.contributionsUpdatedAt as string) ?? null,
      login: (meta.login as string) ?? null,
    };
  }

  private async fetchUser(userId: string, token: string): Promise<GithubProfile> {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'careeros/0.0.1',
      },
    });
    if (!res.ok) {
      if (res.status === 401) {
        await this.recordRejection(userId, 'invalid_token', []);
        throw new BadRequestException('Invalid GitHub token');
      }
      throw new BadRequestException(`GitHub returned ${res.status}`);
    }

    // Scope gate. Classic PATs return a comma-separated `x-oauth-scopes` header
    // (may be empty spaces). Fine-grained PATs return an EMPTY header even on
    // 200. We reject fine-grained for the MVP because scope shape differs and
    // we don't want to guess-approve a token whose real permissions we can't
    // introspect from headers alone.
    const scopeHeader = res.headers.get('x-oauth-scopes');
    const scopes = parseScopeHeader(scopeHeader);
    const violation = classifyScopes(scopeHeader, scopes);
    if (violation) {
      await this.recordRejection(userId, violation.reason, violation.offending);
      throw new InvalidTokenScopeError(violation.message, violation.offending);
    }

    const json = (await res.json()) as {
      login: string;
      name: string | null;
      avatar_url: string;
      public_repos: number;
      followers: number;
    };
    return {
      login: json.login,
      name: json.name,
      avatarUrl: json.avatar_url,
      publicRepos: json.public_repos,
      followers: json.followers,
    };
  }

  // Best-effort audit write. If the audit log itself is down we still want the
  // reject to surface to the user, so any failure here is swallowed.
  private async recordRejection(
    userId: string,
    reason: string,
    offendingScopes: string[],
  ): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId,
          actor: 'user',
          action: 'github.token.rejected',
          resourceType: 'integration',
          resourceId: 'github',
          payload: { reason, offendingScopes },
        },
      });
    } catch {
      // ponytail: audit log write is best-effort; caller error still wins.
    }
  }
}

// --- pure helpers (exported for tests) ---

export function parseScopeHeader(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface ScopeViolation {
  reason: string; // machine label for audit_log
  message: string; // user-facing
  offending: string[];
}

// Returns null if the scopes are acceptable, otherwise a violation record.
// Rules:
//  - `x-oauth-scopes` header ABSENT (null) → GitHub didn't return the header at
//    all; treat as unknown/reject.
//  - `x-oauth-scopes` header PRESENT but empty → fine-grained PAT. Reject for
//    MVP; tell the user to generate a classic PAT.
//  - Any scope in BLOCKED_SCOPES → reject, list them.
//  - Any scope not in ALLOWED_SCOPES → reject, list them.
export function classifyScopes(
  header: string | null | undefined,
  scopes: string[],
): ScopeViolation | null {
  if (header === null || header === undefined) {
    return {
      reason: 'missing_scope_header',
      message:
        'GitHub did not return token scopes. Generate a classic personal access token with only "repo" and "read:user".',
      offending: [],
    };
  }
  if (scopes.length === 0) {
    return {
      reason: 'fine_grained_not_supported',
      message:
        'Fine-grained personal access tokens are not supported yet. Generate a classic PAT with only "repo" and "read:user".',
      offending: [],
    };
  }
  const blocked = scopes.filter((s) => BLOCKED_SCOPES.has(s));
  if (blocked.length > 0) {
    return {
      reason: 'blocked_scope',
      message: `Token includes blocked scopes: ${blocked.join(', ')}. Regenerate with only "repo" and "read:user".`,
      offending: blocked,
    };
  }
  const disallowed = scopes.filter((s) => !ALLOWED_SCOPES.has(s));
  if (disallowed.length > 0) {
    return {
      reason: 'disallowed_scope',
      message: `Token includes scopes outside the allowlist: ${disallowed.join(', ')}. Regenerate with only "repo" and "read:user".`,
      offending: disallowed,
    };
  }
  return null;
}
