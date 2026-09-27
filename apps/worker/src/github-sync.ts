// github.sync job handler. Fetches the user's GitHub repos, pulls per-repo language stats,
// emits one `presence` Evidence row per (skill, repo) pair, and re-aggregates each affected skill.
// Also refreshes the year contribution calendar on the Integration.metadata blob.
//
// Slice 2b (C-P1.1d): after the repo-level presence pass, also pulls the last
// COMMIT_LOOKBACK_MONTHS of commits per repo, filters to the user's own
// authorship, runs the ext/framework/AI-assist analyzers, and emits
// per-file / per-framework / per-authorship Evidence rows via the shared
// git-analysis package.
//
// ponytail: language DETECTION is file-extension + shebang, not tree-sitter
// AST parsing. The AST upgrade path is called out in packages/shared/src/
// git-analysis/language-detect.ts.
import { Octokit } from '@octokit/rest';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import {
  analyzeRepoCommits,
  type CommitWithFiles,
  type EvidenceRow,
  type GithubSyncPayload,
  type KnownEmails,
} from '@careeros/shared';
import { syncSkillState } from './aggregator.js';
import { GH_LANGUAGE_TO_SKILL } from './skills-seed.js';

const KEY = loadMasterKey();
const GITHUB_TOKEN_PURPOSE = 'integration:github:token';
const MAX_REPOS = 100; // one page; slice 2b paginates
const REPO_SOURCE_KIND = 'github_repo';

// Commit-scan tunables. Kept as module consts (no env plumbing yet) so slice
// 2b lands with sensible defaults; upgrade path is a per-user setting.
const COMMIT_LOOKBACK_MONTHS = 6;
const COMMITS_PER_REPO = 100;

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

  // Known-emails set for the contributor filter. Fetched ONCE per sync; if the
  // /user/emails call fails (token lacks user:email scope) we fall back to
  // login-noreply only. Never guess.
  const knownEmails = await fetchKnownEmails(octokit, login).catch((err) => {
    child.warn({ err: (err as Error).message }, 'emails fetch failed; falling back to login noreply');
    return login ? { emails: [], githubLogin: login } : { emails: [] };
  });

  const touchedSkillIds = new Set<string>();
  let evidenceAdded = 0;
  let commitRowsAdded = 0;
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

    // Commit ingest — the meat of C-P1.1. Pull the last COMMIT_LOOKBACK_MONTHS
    // of commits touching this repo, filter to the user's own authorship, run
    // the analyzers, and emit per-file / per-framework / per-authorship rows.
    // Any failure here is per-repo isolated: log + continue to the next repo.
    try {
      const commits = await fetchCommitsWithFiles(octokit, owner, repo.name);
      const analyzed = analyzeRepoCommits({
        repoRef: repo.full_name,
        commits,
        knownEmails,
      });
      if (analyzed.rows.length > 0) {
        const written = await persistCommitEvidence(
          prisma,
          userId,
          analyzed.rows,
          repo.id,
          touchedSkillIds,
        );
        commitRowsAdded += written;
        evidenceAdded += written;
      }
    } catch (err) {
      child.warn(
        { repo: repo.full_name, err: (err as Error).message },
        'commit ingest failed',
      );
    }
  }

  for (const skillId of touchedSkillIds) {
    await syncSkillState(prisma, userId, skillId, now);
  }

  child.info(
    {
      reposScanned: repos.data.length,
      skillsTouched: touchedSkillIds.size,
      evidenceAdded,
      commitRowsAdded,
      contributions,
    },
    'github.sync complete',
  );
  return { reposScanned: repos.data.length, skillsTouched: touchedSkillIds.size, evidenceAdded, contributions };
}

// --- commit ingest helpers (slice 2b) ---

/**
 * Pull the last COMMIT_LOOKBACK_MONTHS of commits from a repo, expand each to
 * its files-touched list. Bounded by COMMITS_PER_REPO so a busy monorepo does
 * not eat the sync budget. Failures here bubble up to the caller which logs
 * and continues to the next repo.
 */
async function fetchCommitsWithFiles(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<CommitWithFiles[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - COMMIT_LOOKBACK_MONTHS);
  const list = await octokit.rest.repos.listCommits({
    owner,
    repo: name,
    since: since.toISOString(),
    per_page: COMMITS_PER_REPO,
  });
  const out: CommitWithFiles[] = [];
  for (const c of list.data) {
    // The list endpoint does not return files touched; fetch each commit
    // individually. This is N+1 by design — one call per commit — but bounded
    // by COMMITS_PER_REPO and skipped on already-imported shas via the
    // per-row dedupe in persistCommitEvidence.
    let detail: Awaited<ReturnType<typeof octokit.rest.repos.getCommit>>;
    try {
      detail = await octokit.rest.repos.getCommit({ owner, repo: name, ref: c.sha });
    } catch {
      continue;
    }
    const files = (detail.data.files ?? [])
      .map((f) => f.filename)
      .filter((s): s is string => typeof s === 'string');
    const stats = detail.data.stats ?? { additions: 0, deletions: 0 };
    out.push({
      sha: c.sha,
      message: c.commit.message ?? '',
      authorEmail: c.commit.author?.email ?? null,
      committerEmail: c.commit.committer?.email ?? null,
      authoredAt: c.commit.author?.date ? new Date(c.commit.author.date) : new Date(),
      additions: stats.additions ?? 0,
      deletions: stats.deletions ?? 0,
      filesTouched: files.length,
      files,
    });
  }
  return out;
}

/**
 * Fetch every email GitHub knows about for the authed user. Requires the
 * `user:email` scope; without it the endpoint returns 404. Callers already
 * catch + fall back to the login-noreply.
 */
async function fetchKnownEmails(octokit: Octokit, login: string | null): Promise<KnownEmails> {
  const res = await octokit.rest.users.listEmailsForAuthenticatedUser({ per_page: 100 });
  const emails = res.data
    .map((r) => r.email)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  return login ? { emails, githubLogin: login } : { emails };
}

/**
 * Insert Evidence rows from analyzeRepoCommits. Dedupes per (userId, skillId,
 * sourceRef.kind, sourceRef.sha, sourceRef.path) via a raw JSON predicate
 * matching the shape github-sync already uses for repo-level dedupe.
 * Registers every touched skill so the outer sync loop re-aggregates state.
 */
async function persistCommitEvidence(
  prisma: PrismaClient,
  userId: string,
  rows: EvidenceRow[],
  repoId: number,
  touchedSkillIds: Set<string>,
): Promise<number> {
  let written = 0;
  for (const row of rows) {
    const src = { ...row.sourceRef, repoId };
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM evidence
      WHERE "userId" = ${userId}::uuid
        AND "skillId" = ${row.skillId}
        AND "signal" = ${row.signal}
        AND "sourceRef"->>'kind' = ${row.sourceRef.kind}
        AND "sourceRef"->>'sha' = ${row.sourceRef.sha}
        AND COALESCE("sourceRef"->>'path', '') = ${row.sourceRef.path ?? ''}
      LIMIT 1
    `;
    if (existing.length > 0) {
      touchedSkillIds.add(row.skillId);
      continue;
    }
    const data: Prisma.EvidenceUncheckedCreateInput = {
      userId,
      skillId: row.skillId,
      kind: row.kind,
      signal: row.signal,
      weightHint: row.weightHint.toFixed(3),
      sourceRef: src as unknown as Prisma.InputJsonValue,
      detail: row.detail as unknown as Prisma.InputJsonValue,
      observedAt: row.observedAt,
    };
    await prisma.evidence.create({ data });
    written += 1;
    touchedSkillIds.add(row.skillId);
  }
  return written;
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
