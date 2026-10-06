// Slack OAuth v2 code exchange + encrypted token store.
//
// Single-user tool: the OAuth callback receives a temporary `code` from
// Slack, we POST it to https://slack.com/api/oauth.v2.access with the
// client_id/secret, and persist the resulting bot token in encrypted_secrets
// (purpose = "integration:slack:bot_token"). No user session required for the
// exchange itself - Slack proves possession by minting the code.
//
// ponytail: hand-rolled OAuth exchange, no @slack/oauth. It's one POST +
// one DB write; a dep would triple the LOC.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { encrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';

const KEY = loadMasterKey();
const PURPOSE = 'integration:slack:bot_token';
const OAUTH_URL = 'https://slack.com/api/oauth.v2.access';

/**
 * F.11c: audit of Slack bot scopes the shipped code actually uses.
 *   `commands`   - required to receive slash commands (E.2 shipped).
 *   `chat:write` - required to post to any channel/DM via chat.postMessage
 *                   (planned for E.3 daily-brief; the built-in SlackChannel
 *                   in @careeros/messaging assumes this).
 * Anything the Slack app manifest requests beyond this list is dead
 * grant; the audit hook logs a warning at OAuth-completion time so the
 * operator can trim the manifest before public release.
 *
 * See docs/oauth-scope-audit.md for the cross-integration table.
 */
export const EXPECTED_SLACK_SCOPES: readonly string[] = ['commands', 'chat:write'];

export interface ScopeAudit {
  readonly granted: readonly string[];
  readonly expected: readonly string[];
  readonly missing: readonly string[];
  readonly excess: readonly string[];
}

/**
 * Pure comparison; exposed for tests. `granted` order is preserved; both
 * `missing` and `excess` are sorted for stable log lines + snapshots.
 */
export function auditSlackScopes(granted: readonly string[]): ScopeAudit {
  const grantedSet = new Set(granted);
  const expectedSet = new Set(EXPECTED_SLACK_SCOPES);
  const missing = [...expectedSet].filter((s) => !grantedSet.has(s)).sort();
  const excess = [...grantedSet].filter((s) => !expectedSet.has(s)).sort();
  return {
    granted,
    expected: EXPECTED_SLACK_SCOPES,
    missing,
    excess,
  };
}

export interface SlackOAuthResult {
  ok: true;
  teamId: string;
  teamName: string | null;
  botUserId: string;
  appId: string;
  scopes: string[];
}

export interface SlackOAuthApiResponse {
  ok: boolean;
  error?: string;
  access_token?: string; // bot token (xoxb-...)
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id: string; name: string };
  authed_user?: { id: string };
}

@Injectable()
export class SlackOAuthService {
  private readonly logger = new Logger(SlackOAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Exchange the temporary `code` for a bot token, then encrypt + store it.
   * `redirectUri` MUST match the one registered in the Slack app manifest.
   */
  async completeInstall(
    code: string,
    redirectUri: string,
    userId?: string,
  ): Promise<SlackOAuthResult> {
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new BadRequestException('Slack OAuth env vars missing');
    }

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    });
    if (!res.ok) {
      throw new BadRequestException(`Slack oauth.v2.access HTTP ${res.status}`);
    }
    const json = (await res.json()) as SlackOAuthApiResponse;
    if (!json.ok || !json.access_token || !json.team) {
      // Slack always returns ok=false with an `error` code on failure.
      throw new BadRequestException(`Slack OAuth failed: ${json.error ?? 'unknown_error'}`);
    }

    const ciphertext = encrypt(json.access_token, KEY, PURPOSE);
    const secret = await this.prisma.encryptedSecret.upsert({
      where: {
        ownerType_ownerId_purpose: {
          ownerType: 'system',
          ownerId: null as unknown as string,
          purpose: PURPOSE,
        },
      },
      create: {
        ownerType: 'system',
        ownerId: null,
        purpose: PURPOSE,
        ciphertext,
      },
      update: { ciphertext },
    });

    // Bind the workspace to the Career OS user who started the install so
    // inbound Slack interactions can be attributed (single-user default, but
    // the binding is what makes multi-user possible later). Omitted for
    // out-of-band installs that call completeInstall directly.
    if (userId) {
      const metadata = {
        teamId: json.team.id,
        teamName: json.team.name ?? null,
        botUserId: json.bot_user_id ?? null,
        appId: json.app_id ?? null,
      };
      await this.prisma.integration.upsert({
        where: { userId_kind: { userId, kind: 'slack' } },
        create: {
          userId,
          kind: 'slack',
          status: 'connected',
          tokenSecretId: secret.id,
          metadata,
        },
        update: { status: 'connected', tokenSecretId: secret.id, metadata },
      });
    }

    const scopes = (json.scope ?? '').split(',').filter(Boolean);
    const audit = auditSlackScopes(scopes);
    if (audit.missing.length > 0) {
      this.logger.warn(
        `slack install T=${json.team.id} missing scopes: ${audit.missing.join(',')} (features that need them will fail at runtime)`,
      );
    }
    if (audit.excess.length > 0) {
      this.logger.warn(
        `slack install T=${json.team.id} granted unused scopes: ${audit.excess.join(',')} (trim from the app manifest for least-privilege; F.11c)`,
      );
    }

    this.logger.log(`slack workspace installed: ${json.team.id}`);
    return {
      ok: true,
      teamId: json.team.id,
      teamName: json.team.name ?? null,
      botUserId: json.bot_user_id ?? '',
      appId: json.app_id ?? '',
      scopes,
    };
  }

  /**
   * Look up the currently-installed bot token. Decrypt happens lazily so the
   * service can be constructed in tests without KEK access.
   */
  async loadBotToken(): Promise<string | null> {
    const row = await this.prisma.encryptedSecret.findUnique({
      where: {
        ownerType_ownerId_purpose: {
          ownerType: 'system',
          ownerId: null as unknown as string,
          purpose: PURPOSE,
        },
      },
    });
    if (!row) return null;
    const { decrypt } = await import('@careeros/secrets');
    return decrypt(row.ciphertext, KEY, PURPOSE);
  }
}
