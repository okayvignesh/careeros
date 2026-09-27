// GitLab integration service (public gitlab.com + self-hosted enterprise).
// Mirrors the GitHub service (../github/github.service.ts) with two extras:
//   1. `baseUrl` — nullable, defaults to https://gitlab.com. If self-hosted,
//      goes through `safeFetch` (SSRF guard) + per-user host allowlist opt-in
//      before any request lands (Wave A A-C2 + A-H6b).
//   2. PAT scope-gate calls GitLab's `/api/v4/personal_access_tokens/self`
//      (an authoritative endpoint that returns scopes, revoked flag, and
//      expires_at). Requires scopes ⊆ {read_api, read_user, read_repository}.
//
// Delivers A-H6b. Every reject is written to audit_log so an operator can
// tell rejected connects from silent failures.
import { Injectable, BadRequestException } from '@nestjs/common';
import { encrypt, loadMasterKey } from '@careeros/secrets';
import { safeFetch, SsrfBlockedError, type AssertPublicUrlOptions } from '@careeros/shared/net';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../../common/queue.service';

const KEY = loadMasterKey();
const PURPOSE = 'integration:gitlab:token';
const DEFAULT_BASE_URL = 'https://gitlab.com';
const DEFAULT_HOST = 'gitlab.com';

// GitLab PAT scope policy for A-H6b. Anything outside `ALLOWED` (or in
// `BLOCKED`) is rejected before we ever persist the token. `BLOCKED` lists the
// high-blast-radius scopes we want a hard-fail message for; anything else that
// isn't in `ALLOWED` gets the same reject with a generic message.
const ALLOWED_SCOPES = new Set(['read_api', 'read_user', 'read_repository']);
const BLOCKED_SCOPES = new Set([
  'api',
  'write_repository',
  'write_registry',
  'sudo',
  'admin_mode',
  'ai_features',
]);

export interface GitlabProfile {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  webUrl: string;
}

// Thrown when the PAT the user pasted carries scopes we refuse to persist.
export class InvalidGitlabTokenScopeError extends BadRequestException {
  constructor(
    public readonly reason: string,
    public readonly offendingScopes: string[] = [],
  ) {
    super({ message: reason, offendingScopes });
  }
}

// Thrown when the user-supplied self-hosted baseUrl fails SSRF / allowlist.
export class InvalidGitlabBaseUrlError extends BadRequestException {
  constructor(public readonly reason: string, public readonly host: string | undefined) {
    super({ message: `Self-hosted GitLab URL rejected: ${reason}`, host });
  }
}

export interface SaveTokenInput {
  pat: string;
  baseUrl?: string | null;
  /**
   * Explicit opt-in from the user that this baseUrl is theirs and should be
   * added to the host allowlist for this session. Without it we refuse to
   * touch any host outside `gitlab.com`. Mirrors the "per-user opt-in host"
   * clause in Wave A A-C2.
   */
  allowlistOptIn?: boolean;
}

@Injectable()
export class GitlabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async saveToken(userId: string, input: SaveTokenInput): Promise<GitlabProfile> {
    const { baseUrl, host, fetchOpts } = await this.resolveBaseUrl(userId, input);

    // Validate the token FIRST via the authoritative PAT-introspection endpoint.
    // Any throw here means NO DB write, NO sync enqueue.
    const profile = await this.fetchTokenAndProfile(userId, input.pat, baseUrl, fetchOpts);

    const ciphertext = encrypt(input.pat, KEY, PURPOSE);
    const secret = await this.prisma.encryptedSecret.upsert({
      where: {
        ownerType_ownerId_purpose: { ownerType: 'user', ownerId: userId, purpose: PURPOSE },
      },
      create: { ownerType: 'user', ownerId: userId, purpose: PURPOSE, ciphertext },
      update: { ciphertext },
    });

    await this.prisma.integration.upsert({
      where: { userId_kind: { userId, kind: 'gitlab' } },
      create: {
        userId,
        kind: 'gitlab',
        status: 'connected',
        tokenSecretId: secret.id,
        baseUrl: host === DEFAULT_HOST ? null : baseUrl,
        metadata: profile as unknown as object,
      },
      update: {
        status: 'connected',
        tokenSecretId: secret.id,
        baseUrl: host === DEFAULT_HOST ? null : baseUrl,
        metadata: profile as unknown as object,
      },
    });

    await this.recordAudit(userId, 'gitlab.token.saved', {
      host,
      selfHosted: host !== DEFAULT_HOST,
    });

    await this.queue.enqueueGitlabSync({ userId, reason: 'setup' });

    return profile;
  }

  async resync(userId: string, reason: 'manual' | 'scheduled' = 'manual'): Promise<void> {
    await this.queue.enqueueGitlabSync({ userId, reason });
  }

  async disconnect(userId: string): Promise<void> {
    await this.prisma.integration.update({
      where: { userId_kind: { userId, kind: 'gitlab' } },
      data: { status: 'revoked', tokenSecretId: null },
    });
  }

  async getConnection(userId: string) {
    return this.prisma.integration.findUnique({
      where: { userId_kind: { userId, kind: 'gitlab' } },
    });
  }

  /**
   * Reachability + rate-limit probe. Returns the current /user response and
   * the RateLimit-Remaining / RateLimit-Reset headers so a settings panel can
   * warn before a sync burns quota. No writes, no queue enqueue.
   */
  async probe(userId: string): Promise<{
    ok: boolean;
    status: number;
    rateLimitRemaining: number | null;
    rateLimitReset: number | null;
  }> {
    const integration = await this.getConnection(userId);
    if (!integration || integration.status !== 'connected' || !integration.tokenSecretId) {
      return { ok: false, status: 0, rateLimitRemaining: null, rateLimitReset: null };
    }
    const baseUrl = integration.baseUrl ?? DEFAULT_BASE_URL;
    const host = new URL(baseUrl).hostname.toLowerCase();
    const fetchOpts: AssertPublicUrlOptions =
      host === DEFAULT_HOST ? {} : { allowlist: [host] };

    // We do NOT decrypt-and-send the token here in the MVP — probe uses the
    // unauthenticated /version endpoint which is enough to say "instance is
    // reachable" and to read rate-limit headers. Authenticated probing lands
    // when a settings panel wires it.
    const res = await safeFetch(`${baseUrl}/api/v4/version`, {}, fetchOpts);
    return {
      ok: res.ok,
      status: res.status,
      rateLimitRemaining: parseIntOrNull(res.headers.get('ratelimit-remaining')),
      rateLimitReset: parseIntOrNull(res.headers.get('ratelimit-reset')),
    };
  }

  // ---- gitlab REST helpers (used by the sync worker via the shared client
  //      as well, but re-exposed here for controller-driven read paths). ----

  async listProjects(userId: string, page = 1, perPage = 50): Promise<unknown[]> {
    const { baseUrl, fetchOpts, token } = await this.contextForUser(userId);
    const res = await this.callGitlab(
      `${baseUrl}/api/v4/projects?membership=true&per_page=${perPage}&page=${page}&order_by=last_activity_at`,
      token,
      fetchOpts,
    );
    return (await res.json()) as unknown[];
  }

  async listMergeRequests(userId: string, projectId: number | string): Promise<unknown[]> {
    const { baseUrl, fetchOpts, token } = await this.contextForUser(userId);
    const res = await this.callGitlab(
      `${baseUrl}/api/v4/projects/${encodeURIComponent(String(projectId))}/merge_requests?state=all&per_page=50`,
      token,
      fetchOpts,
    );
    return (await res.json()) as unknown[];
  }

  async listReviews(userId: string, projectId: number | string, mrIid: number): Promise<unknown[]> {
    const { baseUrl, fetchOpts, token } = await this.contextForUser(userId);
    const res = await this.callGitlab(
      `${baseUrl}/api/v4/projects/${encodeURIComponent(String(projectId))}/merge_requests/${mrIid}/notes?per_page=50`,
      token,
      fetchOpts,
    );
    return (await res.json()) as unknown[];
  }

  async listPipelines(userId: string, projectId: number | string): Promise<unknown[]> {
    const { baseUrl, fetchOpts, token } = await this.contextForUser(userId);
    const res = await this.callGitlab(
      `${baseUrl}/api/v4/projects/${encodeURIComponent(String(projectId))}/pipelines?per_page=50`,
      token,
      fetchOpts,
    );
    return (await res.json()) as unknown[];
  }

  async listJobs(userId: string, projectId: number | string, pipelineId: number): Promise<unknown[]> {
    const { baseUrl, fetchOpts, token } = await this.contextForUser(userId);
    const res = await this.callGitlab(
      `${baseUrl}/api/v4/projects/${encodeURIComponent(String(projectId))}/pipelines/${pipelineId}/jobs?per_page=50`,
      token,
      fetchOpts,
    );
    return (await res.json()) as unknown[];
  }

  // ---- privates ----

  private async contextForUser(
    userId: string,
  ): Promise<{ baseUrl: string; fetchOpts: AssertPublicUrlOptions; token: string }> {
    const integration = await this.getConnection(userId);
    if (!integration || integration.status !== 'connected' || !integration.tokenSecretId) {
      throw new BadRequestException('GitLab not connected');
    }
    const secret = await this.prisma.encryptedSecret.findUnique({
      where: { id: integration.tokenSecretId },
    });
    if (!secret) throw new BadRequestException('GitLab token secret missing');
    const { decrypt } = await import('@careeros/secrets');
    const token = decrypt(secret.ciphertext, KEY, PURPOSE);
    const baseUrl = integration.baseUrl ?? DEFAULT_BASE_URL;
    const host = new URL(baseUrl).hostname.toLowerCase();
    const fetchOpts: AssertPublicUrlOptions =
      host === DEFAULT_HOST ? {} : { allowlist: [host] };
    return { baseUrl, fetchOpts, token };
  }

  private async callGitlab(
    url: string,
    token: string,
    fetchOpts: AssertPublicUrlOptions,
  ): Promise<Response> {
    const res = await safeFetch(
      url,
      {
        headers: {
          'private-token': token,
          accept: 'application/json',
          'user-agent': 'careeros/0.0.1',
        },
      },
      fetchOpts,
    );
    if (!res.ok) throw new BadRequestException(`GitLab returned ${res.status}`);
    return res;
  }

  private async resolveBaseUrl(
    userId: string,
    input: SaveTokenInput,
  ): Promise<{ baseUrl: string; host: string; fetchOpts: AssertPublicUrlOptions }> {
    const raw = (input.baseUrl ?? '').trim();
    if (!raw) {
      return {
        baseUrl: DEFAULT_BASE_URL,
        host: DEFAULT_HOST,
        fetchOpts: {},
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      await this.recordAudit(userId, 'gitlab.baseurl.ssrf_rejected', {
        reason: 'invalid_url',
        raw,
      });
      throw new InvalidGitlabBaseUrlError('invalid_url', undefined);
    }
    const host = parsed.hostname.toLowerCase();

    if (host === DEFAULT_HOST) {
      // Explicit gitlab.com is fine — normalise the URL and use the default
      // allowlist (safeFetch has gitlab.com baked in).
      return {
        baseUrl: `${parsed.protocol}//${parsed.host}`,
        host,
        fetchOpts: {},
      };
    }

    // Any non-default host requires the user to have explicitly opted in.
    if (!input.allowlistOptIn) {
      await this.recordAudit(userId, 'gitlab.baseurl.ssrf_rejected', {
        reason: 'allowlist_opt_in_missing',
        host,
      });
      throw new InvalidGitlabBaseUrlError('allowlist_opt_in_missing', host);
    }

    return {
      baseUrl: `${parsed.protocol}//${parsed.host}`,
      host,
      fetchOpts: { allowlist: [host] },
    };
  }

  private async fetchTokenAndProfile(
    userId: string,
    token: string,
    baseUrl: string,
    fetchOpts: AssertPublicUrlOptions,
  ): Promise<GitlabProfile> {
    // Introspect the PAT first: /personal_access_tokens/self returns scopes,
    // revoked, and expires_at. This is the ONLY endpoint that lets us do a
    // proper scope + expiry check for user-supplied PATs.
    let introspection: Response;
    try {
      introspection = await safeFetch(
        `${baseUrl}/api/v4/personal_access_tokens/self`,
        {
          headers: {
            'private-token': token,
            accept: 'application/json',
            'user-agent': 'careeros/0.0.1',
          },
        },
        fetchOpts,
      );
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        await this.recordAudit(userId, 'gitlab.baseurl.ssrf_rejected', {
          reason: err.detail.reason,
          host: err.detail.host,
        });
        throw new InvalidGitlabBaseUrlError(err.detail.reason, err.detail.host);
      }
      throw err;
    }

    if (!introspection.ok) {
      if (introspection.status === 401) {
        await this.recordAudit(userId, 'gitlab.token.rejected', {
          reason: 'invalid_token',
        });
        throw new BadRequestException('Invalid GitLab token');
      }
      // 404 on this endpoint means the GitLab version is <13.6 OR the token is
      // OAuth2 (which routes differently). Reject with a clear message; a
      // fallback OAuth2 flow is a future slice.
      await this.recordAudit(userId, 'gitlab.token.rejected', {
        reason: `introspection_${introspection.status}`,
      });
      throw new BadRequestException(`GitLab token introspection returned ${introspection.status}`);
    }

    const tokenInfo = (await introspection.json()) as {
      id: number;
      name: string;
      revoked: boolean;
      scopes: string[];
      active?: boolean;
      expires_at: string | null;
    };
    const violation = classifyScopes(tokenInfo);
    if (violation) {
      await this.recordAudit(userId, 'gitlab.token.rejected', {
        reason: violation.reason,
        offendingScopes: violation.offending,
      });
      throw new InvalidGitlabTokenScopeError(violation.message, violation.offending);
    }

    // Now the token is trusted — fetch the profile for display.
    const meRes = await safeFetch(
      `${baseUrl}/api/v4/user`,
      {
        headers: {
          'private-token': token,
          accept: 'application/json',
          'user-agent': 'careeros/0.0.1',
        },
      },
      fetchOpts,
    );
    if (!meRes.ok) {
      throw new BadRequestException(`GitLab /user returned ${meRes.status}`);
    }
    const me = (await meRes.json()) as {
      id: number;
      username: string;
      name: string | null;
      avatar_url: string | null;
      web_url: string;
    };
    return {
      id: me.id,
      username: me.username,
      name: me.name,
      avatarUrl: me.avatar_url,
      webUrl: me.web_url,
    };
  }

  private async recordAudit(
    userId: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId,
          actor: 'user',
          action,
          resourceType: 'integration',
          resourceId: 'gitlab',
          payload,
        },
      });
    } catch {
      // ponytail: audit log write is best-effort; caller error still wins.
    }
  }
}

function parseIntOrNull(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// --- pure helpers (exported for tests) ---

export interface GitlabScopeViolation {
  reason: string; // machine label for audit_log
  message: string; // user-facing
  offending: string[];
}

export interface GitlabTokenInfo {
  scopes: string[];
  revoked: boolean;
  active?: boolean;
  expires_at: string | null;
}

/**
 * Pure scope + expiry + revocation check. Returns null if the PAT is safe to
 * persist, otherwise a violation record. Exported so tests can cover every
 * branch without spinning up MSW.
 */
export function classifyScopes(info: GitlabTokenInfo, now: Date = new Date()): GitlabScopeViolation | null {
  if (info.revoked) {
    return {
      reason: 'revoked',
      message: 'Token is revoked. Regenerate a new personal access token.',
      offending: [],
    };
  }
  if (info.active === false) {
    return {
      reason: 'inactive',
      message: 'Token is not active. Regenerate a new personal access token.',
      offending: [],
    };
  }
  if (info.expires_at) {
    const exp = new Date(info.expires_at);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < now.getTime()) {
      return {
        reason: 'expired',
        message: 'Token has already expired. Regenerate with a future expiry.',
        offending: [],
      };
    }
  }
  const scopes = Array.isArray(info.scopes) ? info.scopes : [];
  if (scopes.length === 0) {
    return {
      reason: 'no_scopes',
      message: 'Token has no scopes. Regenerate with read_api + read_user + read_repository.',
      offending: [],
    };
  }
  const blocked = scopes.filter((s) => BLOCKED_SCOPES.has(s));
  if (blocked.length > 0) {
    return {
      reason: 'blocked_scope',
      message: `Token includes blocked scopes: ${blocked.join(', ')}. Regenerate with only read_api + read_user + read_repository.`,
      offending: blocked,
    };
  }
  const disallowed = scopes.filter((s) => !ALLOWED_SCOPES.has(s));
  if (disallowed.length > 0) {
    return {
      reason: 'disallowed_scope',
      message: `Token includes scopes outside the allowlist: ${disallowed.join(', ')}. Regenerate with only read_api + read_user + read_repository.`,
      offending: disallowed,
    };
  }
  return null;
}
