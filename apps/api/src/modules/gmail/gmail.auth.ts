// Gmail credential plumbing shared by the inbound (GmailService) and outbound
// (GmailOutboundService) sides. Extracted so both resolve the user's OAuth
// client from the same encrypted refresh token instead of duplicating the
// decrypt + integration lookup.
import { BadRequestException, Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';

export const KEY = loadMasterKey();
export const GMAIL_TOKEN_PURPOSE = 'integration:gmail:oauth';

// Scopes: `gmail.readonly` powers inbound watch/classification; `gmail.compose`
// is the least-privilege grant that covers `drafts.create`, `drafts.send`, and
// `messages.send` for F.5 outbound. (There is no read-only outbound path.)
// Both are requested together so one consent covers the daily assistant.
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

export interface GmailEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  topicName: string; /// projects/<gcp>/topics/<topic>
  pushAudience: string; /// exact `aud` Google will sign - the push URL
}

export function readGmailEnv(): GmailEnv | null {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI;
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  const pushAudience = process.env.GMAIL_PUBSUB_AUDIENCE;
  if (!clientId || !clientSecret || !redirectUri || !topicName || !pushAudience) {
    return null;
  }
  return { clientId, clientSecret, redirectUri, topicName, pushAudience };
}

export function requireGmailEnv(): GmailEnv {
  const env = readGmailEnv();
  if (!env) {
    throw new BadRequestException(
      'Gmail integration is not configured. Set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REDIRECT_URI, GMAIL_PUBSUB_TOPIC, GMAIL_PUBSUB_AUDIENCE.',
    );
  }
  return env;
}

@Injectable()
export class GmailAuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** OAuth client seeded with only clientId/secret/redirect (no user token). */
  clientForEnv(env: GmailEnv): OAuth2Client {
    return new google.auth.OAuth2(env.clientId, env.clientSecret, env.redirectUri);
  }

  /** Consent URL. `state` binds the flow to the signed-in user. */
  consentUrl(env: GmailEnv, state: string): string {
    return this.clientForEnv(env).generateAuthUrl({
      access_type: 'offline', /// required to get refresh_token
      prompt: 'consent', /// force refresh_token even if the user has consented before
      scope: OAUTH_SCOPES,
      state,
    });
  }

  /**
   * OAuth client authenticated as `userId`. Throws when the user has no
   * connected Gmail integration or the stored secret is gone.
   */
  async userClient(userId: string, env: GmailEnv): Promise<OAuth2Client> {
    const integration = await this.prisma.integration.findUnique({
      where: { userId_kind: { userId, kind: 'gmail' } },
    });
    if (!integration || integration.status !== 'connected' || !integration.tokenSecretId) {
      throw new BadRequestException('Gmail not connected');
    }
    const secret = await this.prisma.encryptedSecret.findUnique({
      where: { id: integration.tokenSecretId },
    });
    if (!secret) throw new BadRequestException('Gmail token secret missing');
    const refreshToken = decrypt(secret.ciphertext, KEY, GMAIL_TOKEN_PURPOSE);
    const client = this.clientForEnv(env);
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  /** Convenience for callers that don't already hold env. */
  async userClientAutoEnv(userId: string): Promise<OAuth2Client> {
    return this.userClient(userId, requireGmailEnv());
  }
}
