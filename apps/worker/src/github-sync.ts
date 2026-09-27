// github.sync job handler. Fetches the user's GitHub repos, pulls per-repo language stats,
// emits one `presence` Evidence row per (skill, repo) pair, and re-aggregates each affected skill.
// Also refreshes the year contribution calendar on the Integration.metadata blob.
//
// ponytail: no per-commit analysis, no tree-sitter, no framework sniffing yet. Language names
// come straight from GitHub's /languages endpoint. Slice 2b will layer in package.json / go.mod
// / requirements.txt / Cargo.toml scanning for framework presence.
import { Octokit } from '@octokit/rest';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import type { GithubSyncPayload } from '@careeros/shared';
import { syncSkillState } from './aggregator.js';
import { GH_LANGUAGE_TO_SKILL } from './skills-seed.js';

const KEY = loadMasterKey();
const GITHUB_TOKEN_PURPOSE = 'integration:github:token';
const MAX_REPOS = 100; // one page; slice 2b paginates
const REPO_SOURCE_KIND = 'github_repo';

// GraphQL query for the contribution calendar (matches github.com/<user>).
const CONTRIB_QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            firstDay
            contributionDays {
              date
              contributionCount
              contributionLevel
              weekday
            }
          }
        }
      }
    }
  }`;

export async function handleGithubSync(
  prisma: PrismaClient,
  logger: Logger,
  payload: GithubSyncPayload,
): Promise<{ reposScanned: number; skillsTouched: number; evidenceAdded: number; contributions: number }> {
  const { userId, reason } = payload;
  const child = logger.child({ userId, reason, job: 'github.sync' });

  const integration = await prisma.integration.findUnique({
    where: { userId_kind: { userId, kind: 'github' } },
  });
  if (!integration || integration.status !== 'connected' || !integration.tokenSecretId) {
    child.warn('github not connected; skipping sync');
    return { reposScanned: 0, skillsTouched: 0, evidenceAdded: 0, contributions: 0 };
  }
  const initialTokenSecretId = integration.tokenSecretId;
  const secret = await prisma.encryptedSecret.findUnique({ where: { id: initialTokenSecretId } });
  if (!secret) {
    child.error('github token secret missing');
    throw new Error('github token secret missing');
  }
  const token = decrypt(secret.ciphertext, KEY, GITHUB_TOKEN_PURPOSE);
  const octokit = new Octokit({ auth: token, userAgent: 'careeros-worker/0.0.1' });

  // Refresh the contribution calendar first so the dashboard reflects "just synced"
  // even if the language scan later hits a rate limit and bails.
  const metadata = (integration.metadata as Record<string, unknown> | null) ?? {};
  const login = typeof metadata.login === 'string' ? metadata.login : null;
  let contributions = 0;
  if (login) {
    try {
      const calendar = await fetchContributions(octokit, login);
      contributions = calendar.totalContributions;
      await prisma.integration.update({
        where: { userId_kind: { userId, kind: 'github' } },
        data: {
          metadata: {
            ...metadata,
            contributions: calendar,
            contributionsUpdatedAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      child.warn({ err: (err as Error).message }, 'contribution calendar fetch failed');
    }
  }

  const repos = await octokit.rest.repos.listForAuthenticatedUser({
    per_page: MAX_REPOS,
    sort: 'pushed',
    affiliation: 'owner,collaborator',
  });
  child.info({ count: repos.data.length }, 'fetched repos');

  const touchedSkillIds = new Set<string>();
  let evidenceAdded = 0;
  const now = new Date();

  for (const repo of repos.data) {
    const owner = repo.owner?.login;
    if (!owner) continue;

    // Bail early if the user disconnected mid-flight. The token in-memory is still
    // valid for octokit but writing would poison a "revoked" integration.
    const fresh = await prisma.integration.findUnique({
      where: { userId_kind: { userId, kind: 'github' } },
      select: { status: true, tokenSecretId: true },
    });
    if (!fresh || fresh.status !== 'connected' || fresh.tokenSecretId !== initialTokenSecretId) {
      child.warn({ repo: repo.full_name }, 'integration changed mid-sync; stopping');
      break;
    }

    try {
      const langs = await octokit.rest.repos.listLanguages({ owner, repo: repo.name });
      const bytes = langs.data as Record<string, number>;

      // Collapse GitHub language names to distinct skill IDs so SCSS + Sass + CSS don't
      // triple-emit for the same repo. Sum bytes across collapsed aliases.
      const perSkill = new Map<string, { language: string; bytes: number }>();
      for (const [ghLang, byteCount] of Object.entries(bytes)) {
        const skillId = GH_LANGUAGE_TO_SKILL[ghLang];
        if (!skillId) continue;
        const cur = perSkill.get(skillId);
        if (cur) {
          cur.bytes += byteCount;
        } else {
          perSkill.set(skillId, { language: ghLang, bytes: byteCount });
        }
      }

      for (const [skillId, { language, bytes: byteCount }] of perSkill) {
        // Dedupe by (userId, skillId, signal, sourceRef->>'repoId') — indexed via JSON path.
        // Prisma JSON `equals` requires a full deep match which would break on any repo
        // metadata drift (rename, byte-count change), so use a raw predicate.
        const existing = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM evidence
          WHERE "userId" = ${userId}::uuid
            AND "skillId" = ${skillId}
            AND "signal" = 'presence'
            AND "sourceRef"->>'kind' = ${REPO_SOURCE_KIND}
            AND ("sourceRef"->>'repoId')::bigint = ${repo.id}
          LIMIT 1
        `;
        if (existing.length > 0) {
          touchedSkillIds.add(skillId);
          continue;
        }
        await prisma.evidence.create({
          data: {
            userId,
            skillId,
            kind: 'code',
            signal: 'presence',
            sourceRef: {
              kind: REPO_SOURCE_KIND,
              repoId: repo.id,
              fullName: repo.full_name,
              language,
              bytes: byteCount,
            },
            detail: { pushedAt: repo.pushed_at, private: repo.private },
            observedAt: repo.pushed_at ? new Date(repo.pushed_at) : now,
          },
        });
        evidenceAdded++;
        touchedSkillIds.add(skillId);
      }
    } catch (err) {
      child.warn({ repo: repo.full_name, err: (err as Error).message }, 'repo language fetch failed');
    }
  }

  for (const skillId of touchedSkillIds) {
    await syncSkillState(prisma, userId, skillId, now);
  }

  child.info(
    { reposScanned: repos.data.length, skillsTouched: touchedSkillIds.size, evidenceAdded, contributions },
    'github.sync complete',
  );
  return { reposScanned: repos.data.length, skillsTouched: touchedSkillIds.size, evidenceAdded, contributions };
}

// --- contribution calendar ---

export interface ContributionDay {
  date: string; // ISO yyyy-mm-dd
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  weekday: number; // 0=Sunday
}
export interface ContributionCalendar {
  totalContributions: number;
  weeks: Array<{ firstDay: string; days: ContributionDay[] }>;
}

const LEVEL_MAP: Record<string, 0 | 1 | 2 | 3 | 4> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

async function fetchContributions(octokit: Octokit, login: string): Promise<ContributionCalendar> {
  const res = await octokit.graphql<{
    user: {
      contributionsCollection: {
        contributionCalendar: {
          totalContributions: number;
          weeks: Array<{
            firstDay: string;
            contributionDays: Array<{
              date: string;
              contributionCount: number;
              contributionLevel: string;
              weekday: number;
            }>;
          }>;
        };
      };
    };
  }>(CONTRIB_QUERY, { login });

  const cal = res.user.contributionsCollection.contributionCalendar;
  return {
    totalContributions: cal.totalContributions,
    weeks: cal.weeks.map((w) => ({
      firstDay: w.firstDay,
      days: w.contributionDays.map((d) => ({
        date: d.date,
        count: d.contributionCount,
        level: LEVEL_MAP[d.contributionLevel] ?? 0,
        weekday: d.weekday,
      })),
    })),
  };
}
