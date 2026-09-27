import { Injectable, BadRequestException } from '@nestjs/common';
import { encrypt, decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../../common/queue.service';

const KEY = loadMasterKey();
const PURPOSE = 'integration:github:token';
const GITHUB_API = 'https://api.github.com';

export interface GithubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  publicRepos: number;
  followers: number;
}

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async saveToken(userId: string, token: string): Promise<GithubProfile> {
    // Verify token by fetching user
    const profile = await this.fetchUser(token);

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

  private async fetchUser(token: string): Promise<GithubProfile> {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'careeros/0.0.1',
      },
    });
    if (!res.ok) {
      if (res.status === 401) throw new BadRequestException('Invalid GitHub token');
      throw new BadRequestException(`GitHub returned ${res.status}`);
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
}
