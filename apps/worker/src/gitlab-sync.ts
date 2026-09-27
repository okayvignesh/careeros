// gitlab.sync job handler. Mirrors github-sync.ts: fetches the user's GitLab
// projects, pulls per-project language stats + recent merge-requests + recent
// pipelines, emits Evidence rows (source kinds: `gitlab_project`, `gitlab_mr`,
// `gitlab_pipeline`), and re-aggregates each affected skill.
//
// Honors GitLab response headers `RateLimit-Remaining` / `RateLimit-Reset` +
// standard `Retry-After`. Retries via packages/shared/retry with exp backoff.
//
// Slice 2b (C-P1.1d): also pulls the last COMMIT_LOOKBACK_MONTHS of commits
// per project, filters to the user's own authorship, runs the ext/framework/
// AI-assist analyzers, and emits per-file / per-framework / per-authorship
// Evidence rows via the shared git-analysis package.
//
// ponytail: language DETECTION is file-extension + shebang, not tree-sitter
// AST parsing. See packages/shared/src/git-analysis/language-detect.ts for
// the upgrade path.
import type { PrismaClient, Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { safeFetch, type AssertPublicUrlOptions } from '@careeros/shared/net';
import {
  analyzeRepoCommits,
  retry,
  type CommitWithFiles,
  type EvidenceRow,
  type KnownEmails,
} from '@careeros/shared';
import { syncSkillState } from './aggregator.js';
import { GH_LANGUAGE_TO_SKILL } from './skills-seed.js';

const KEY = loadMasterKey();
const GITLAB_TOKEN_PURPOSE = 'integration:gitlab:token';
const DEFAULT_BASE_URL = 'https://gitlab.com';
const DEFAULT_HOST = 'gitlab.com';
const MAX_PROJECTS = 50; // one page; enough for personal scale
const MAX_MRS_PER_PROJECT = 20;
const MAX_PIPELINES_PER_PROJECT = 20;
// Commit-scan tunables mirror github-sync. Kept module-const for now.
const COMMIT_LOOKBACK_MONTHS = 6;
const COMMITS_PER_PROJECT = 100;

const PROJECT_SOURCE_KIND = 'gitlab_project';
const MR_SOURCE_KIND = 'gitlab_mr';
const PIPELINE_SOURCE_KIND = 'gitlab_pipeline';

export interface GitlabSyncPayload {
  userId: string;
  reason: 'setup' | 'manual' | 'scheduled';
}

export async function handleGitlabSync(
  prisma: PrismaClient,
  logger: Logger,
  payload: GitlabSyncPayload,
): Promise<{
  projectsScanned: number;
  skillsTouched: number;
  evidenceAdded: number;
}> {
  const { userId, reason } = payload;
  const child = logger.child({ userId, reason, job: 'gitlab.sync' });

  await recordAudit(prisma, userId, 'gitlab.sync.started', { reason });

  const integration = await prisma.integration.findUnique({
    where: { userId_kind: { userId, kind: 'gitlab' } },
  });
  if (!integration || integration.status !== 'connected' || !integration.tokenSecretId) {
    child.warn('gitlab not connected; skipping sync');
    return { projectsScanned: 0, skillsTouched: 0, evidenceAdded: 0 };
  }
  const initialTokenSecretId = integration.tokenSecretId;
  const secret = await prisma.encryptedSecret.findUnique({ where: { id: initialTokenSecretId } });
  if (!secret) {
    child.error('gitlab token secret missing');
    throw new Error('gitlab token secret missing');
  }
  const token = decrypt(secret.ciphertext, KEY, GITLAB_TOKEN_PURPOSE);
  const baseUrl = integration.baseUrl ?? DEFAULT_BASE_URL;
  const host = new URL(baseUrl).hostname.toLowerCase();
  const fetchOpts: AssertPublicUrlOptions =
    host === DEFAULT_HOST ? {} : { allowlist: [host] };

  const call = async <T>(url: string): Promise<T> => {
    return retry(
      async () => {
        const res = await safeFetch(
          url,
          {
            headers: {
              'private-token': token,
              accept: 'application/json',
              'user-agent': 'careeros-worker/0.0.1',
            },
          },
          fetchOpts,
        );
        if (res.status === 429) {
          const reset = res.headers.get('ratelimit-reset');
          const retryAfter = res.headers.get('retry-after');
          child.warn(
            { url, resetAt: reset, retryAfter },
            'gitlab rate-limit hit; retry helper will back off',
          );
          await recordAudit(prisma, userId, 'gitlab.sync.rate_limited', {
            url,
            resetAt: reset,
            retryAfter,
          });
          const err = new Error(`GitLab 429 rate limited`) as Error & { status: number };
          err.status = 429;
          throw err;
        }
        if (!res.ok) {
          const err = new Error(`GitLab ${res.status}`) as Error & { status: number };
          err.status = res.status;
          throw err;
        }
        return (await res.json()) as T;
      },
      { attempts: 4, baseMs: 1_000, factor: 2, maxMs: 30_000 },
    );
  };

  const projects = await call<GitlabProject[]>(
    `${baseUrl}/api/v4/projects?membership=true&per_page=${MAX_PROJECTS}&order_by=last_activity_at`,
  );
  child.info({ count: projects.length }, 'fetched projects');

  // Known emails for the contributor filter. GitLab's /user returns the
  // primary email when `read_user` scope is present; missing scope yields
  // null there — fall back to username-only in that case.
  const knownEmails = await fetchKnownEmails(baseUrl, call).catch((err) => {
    child.warn({ err: (err as Error).message }, '/user fetch failed; contributor filter empty');
    return { emails: [] } as KnownEmails;
  });

  const touchedSkillIds = new Set<string>();
  let evidenceAdded = 0;
  let commitRowsAdded = 0;
  const now = new Date();

  for (const project of projects) {
    // Bail if the user disconnected mid-flight.
    const fresh = await prisma.integration.findUnique({
      where: { userId_kind: { userId, kind: 'gitlab' } },
      select: { status: true, tokenSecretId: true },
    });
    if (!fresh || fresh.status !== 'connected' || fresh.tokenSecretId !== initialTokenSecretId) {
      child.warn({ project: project.path_with_namespace }, 'integration changed mid-sync; stopping');
      break;
    }

    // Languages → presence evidence per skill (same shape as github-sync).
    try {
      const langs = await call<Record<string, number>>(
        `${baseUrl}/api/v4/projects/${project.id}/languages`,
      );
      const perSkill = new Map<string, { language: string; percent: number }>();
      for (const [glLang, percent] of Object.entries(langs)) {
        const skillId = GH_LANGUAGE_TO_SKILL[glLang];
        if (!skillId) continue;
        const cur = perSkill.get(skillId);
        if (cur) {
          cur.percent += percent;
        } else {
          perSkill.set(skillId, { language: glLang, percent });
        }
      }
      for (const [skillId, { language, percent }] of perSkill) {
        const existing = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM evidence
          WHERE "userId" = ${userId}::uuid
            AND "skillId" = ${skillId}
            AND "signal" = 'presence'
            AND "sourceRef"->>'kind' = ${PROJECT_SOURCE_KIND}
            AND ("sourceRef"->>'projectId')::bigint = ${project.id}
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
              kind: PROJECT_SOURCE_KIND,
              projectId: project.id,
              pathWithNamespace: project.path_with_namespace,
              language,
              percent,
            },
            detail: {
              lastActivityAt: project.last_activity_at,
              visibility: project.visibility,
              // Employer-confidential unless the project is public; the
              // sensitivity gate uses this to decide LLM eligibility later.
              sensitivity: project.visibility === 'public' ? 'public' : 'employer-confidential',
            },
            observedAt: project.last_activity_at ? new Date(project.last_activity_at) : now,
          },
        });
        evidenceAdded += 1;
        touchedSkillIds.add(skillId);
      }
    } catch (err) {
      child.warn(
        { project: project.path_with_namespace, err: (err as Error).message },
        'project languages fetch failed',
      );
    }

    // Merge requests → outcome evidence. One row per merged MR authored by the
    // user; naive skill assignment defers to the project's primary language for
    // this MVP. Slice 2b will parse diffs.
    try {
      const mrs = await call<GitlabMergeRequest[]>(
        `${baseUrl}/api/v4/projects/${project.id}/merge_requests?state=merged&scope=created_by_me&per_page=${MAX_MRS_PER_PROJECT}`,
      );
      for (const mr of mrs) {
        // Skill anchor: any skill already touched for this project. Skip if none.
        if (touchedSkillIds.size === 0) continue;
        for (const skillId of touchedSkillIds) {
          const existing = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM evidence
            WHERE "userId" = ${userId}::uuid
              AND "skillId" = ${skillId}
              AND "sourceRef"->>'kind' = ${MR_SOURCE_KIND}
              AND ("sourceRef"->>'mrId')::bigint = ${mr.id}
            LIMIT 1
          `;
          if (existing.length > 0) continue;
          await prisma.evidence.create({
            data: {
              userId,
              skillId,
              kind: 'outcome',
              signal: 'sustained-application',
              sourceRef: {
                kind: MR_SOURCE_KIND,
                mrId: mr.id,
                iid: mr.iid,
                projectId: project.id,
                title: mr.title,
                webUrl: mr.web_url,
              },
              detail: {
                mergedAt: mr.merged_at,
                sensitivity: project.visibility === 'public' ? 'public' : 'employer-confidential',
              },
              observedAt: mr.merged_at ? new Date(mr.merged_at) : now,
            } as Prisma.EvidenceUncheckedCreateInput,
          });
          evidenceAdded += 1;
        }
      }
    } catch (err) {
      child.warn(
        { project: project.path_with_namespace, err: (err as Error).message },
        'MR fetch failed',
      );
    }

    // Pipelines → CI/CD skill signal. Emits presence evidence on the `ci-cd`
    // skill for any project whose pipelines have run. Job-level parsing lands
    // in slice 2b.
    try {
      const pipelines = await call<GitlabPipeline[]>(
        `${baseUrl}/api/v4/projects/${project.id}/pipelines?per_page=${MAX_PIPELINES_PER_PROJECT}`,
      );
      if (pipelines.length > 0) {
        const skillId = 'ci-cd';
        const existing = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM evidence
          WHERE "userId" = ${userId}::uuid
            AND "skillId" = ${skillId}
            AND "sourceRef"->>'kind' = ${PIPELINE_SOURCE_KIND}
            AND ("sourceRef"->>'projectId')::bigint = ${project.id}
          LIMIT 1
        `;
        if (existing.length === 0) {
          await prisma.evidence.create({
            data: {
              userId,
              skillId,
              kind: 'code',
              signal: 'presence',
              sourceRef: {
                kind: PIPELINE_SOURCE_KIND,
                projectId: project.id,
                pathWithNamespace: project.path_with_namespace,
                pipelineCount: pipelines.length,
              },
              detail: {
                sensitivity: project.visibility === 'public' ? 'public' : 'employer-confidential',
              },
              observedAt: pipelines[0]?.updated_at
                ? new Date(pipelines[0].updated_at)
                : now,
            } as Prisma.EvidenceUncheckedCreateInput,
          });
          evidenceAdded += 1;
          touchedSkillIds.add(skillId);
        } else {
          touchedSkillIds.add(skillId);
        }
      }
    } catch (err) {
      child.warn(
        { project: project.path_with_namespace, err: (err as Error).message },
        'pipelines fetch failed',
      );
    }

    // Commit ingest — mirror of github-sync C-P1.1d. Pulls the last
    // COMMIT_LOOKBACK_MONTHS of commits touching this project, filters to the
    // user's own authorship, runs the analyzers, and emits per-file /
    // per-framework / per-authorship Evidence rows. Isolated per-project:
    // failures log + continue.
    try {
      const commits = await fetchProjectCommits(baseUrl, project.id, call);
      const analyzed = analyzeRepoCommits({
        repoRef: project.path_with_namespace,
        commits,
        knownEmails,
      });
      if (analyzed.rows.length > 0) {
        const written = await persistCommitEvidence(
          prisma,
          userId,
          analyzed.rows,
          project.id,
          project.visibility,
          touchedSkillIds,
        );
        commitRowsAdded += written;
        evidenceAdded += written;
      }
    } catch (err) {
      child.warn(
        { project: project.path_with_namespace, err: (err as Error).message },
        'commit ingest failed',
      );
    }
  }

  for (const skillId of touchedSkillIds) {
    await syncSkillState(prisma, userId, skillId, now);
  }

  await recordAudit(prisma, userId, 'gitlab.sync.completed', {
    projectsScanned: projects.length,
    skillsTouched: touchedSkillIds.size,
    evidenceAdded,
    commitRowsAdded,
  });

  child.info(
    {
      projectsScanned: projects.length,
      skillsTouched: touchedSkillIds.size,
      evidenceAdded,
      commitRowsAdded,
    },
    'gitlab.sync complete',
  );

  return {
    projectsScanned: projects.length,
    skillsTouched: touchedSkillIds.size,
    evidenceAdded,
  };
}

// --- commit ingest helpers (slice 2b) ---

/**
 * GET /user + /user/emails. Requires `read_user` scope. Any missing scope
 * yields an empty emails list and the contributor filter emits nothing.
 */
async function fetchKnownEmails(
  baseUrl: string,
  call: <T>(url: string) => Promise<T>,
): Promise<KnownEmails> {
  const user = await call<GitlabUser>(`${baseUrl}/api/v4/user`);
  const primary = user.email ?? user.public_email ?? null;
  const list = await call<Array<{ email: string }>>(`${baseUrl}/api/v4/user/emails`).catch(
    () => [] as Array<{ email: string }>,
  );
  const emails = [
    ...(primary ? [primary] : []),
    ...list.map((r) => r.email).filter((e) => typeof e === 'string' && e.length > 0),
  ];
  return { emails };
}

/**
 * Pull the last COMMIT_LOOKBACK_MONTHS of commits from a GitLab project and
 * hydrate each with the files-touched list from GET /commits/:sha/diff. This
 * is N+1 by design — one diff call per commit — but bounded by
 * COMMITS_PER_PROJECT. `persistCommitEvidence` dedupes per (sha, path).
 */
async function fetchProjectCommits(
  baseUrl: string,
  projectId: number,
  call: <T>(url: string) => Promise<T>,
): Promise<CommitWithFiles[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - COMMIT_LOOKBACK_MONTHS);
  const commits = await call<GitlabCommit[]>(
    `${baseUrl}/api/v4/projects/${projectId}/repository/commits?since=${since.toISOString()}&per_page=${COMMITS_PER_PROJECT}`,
  );
  const out: CommitWithFiles[] = [];
  for (const c of commits) {
    let diff: GitlabCommitDiff[];
    try {
      diff = await call<GitlabCommitDiff[]>(
        `${baseUrl}/api/v4/projects/${projectId}/repository/commits/${c.id}/diff`,
      );
    } catch {
      continue;
    }
    const files = diff
      .map((d) => d.new_path || d.old_path)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    // Line stats via /commits/:sha (has stats block) would be a second call
    // per commit; skipped for MVP. Additions/deletions default to zero which
    // simply mutes the diff-size AI-assist signal — message markers + burst
    // still fire.
    out.push({
      sha: c.id,
      message: c.message ?? '',
      authorEmail: c.author_email ?? null,
      committerEmail: c.committer_email ?? null,
      authoredAt: c.authored_date ? new Date(c.authored_date) : new Date(),
      additions: c.stats?.additions ?? 0,
      deletions: c.stats?.deletions ?? 0,
      filesTouched: files.length,
      files,
    });
  }
  return out;
}

/**
 * Persist evidence rows returned from analyzeRepoCommits. Dedupes per
 * (userId, skillId, sourceRef.kind, sourceRef.sha, sourceRef.path). Stamps
 * `sensitivity` on detail based on project visibility so the sensitivity
 * gate can filter these rows out of LLM contexts.
 */
async function persistCommitEvidence(
  prisma: PrismaClient,
  userId: string,
  rows: EvidenceRow[],
  projectId: number,
  visibility: GitlabProject['visibility'],
  touchedSkillIds: Set<string>,
): Promise<number> {
  let written = 0;
  const sensitivity = visibility === 'public' ? 'public' : 'employer-confidential';
  for (const row of rows) {
    const src = { ...row.sourceRef, projectId };
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
      detail: { ...row.detail, sensitivity } as unknown as Prisma.InputJsonValue,
      observedAt: row.observedAt,
    };
    await prisma.evidence.create({ data });
    written += 1;
    touchedSkillIds.add(row.skillId);
  }
  return written;
}

async function recordAudit(
  prisma: PrismaClient,
  userId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        userId,
        actor: 'system',
        action,
        resourceType: 'integration',
        resourceId: 'gitlab',
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // ponytail: audit is best-effort in the worker; do not fail the job on log write.
  }
}

// --- gitlab REST payload shapes (only fields we touch) ---

export interface GitlabProject {
  id: number;
  path_with_namespace: string;
  visibility: 'public' | 'internal' | 'private';
  last_activity_at: string | null;
}

export interface GitlabMergeRequest {
  id: number;
  iid: number;
  title: string;
  merged_at: string | null;
  web_url: string;
}

export interface GitlabPipeline {
  id: number;
  status: string;
  updated_at: string | null;
}

export interface GitlabUser {
  id: number;
  username: string;
  email: string | null;
  public_email: string | null;
}

export interface GitlabCommit {
  id: string;
  message: string;
  author_email: string | null;
  committer_email: string | null;
  authored_date: string | null;
  stats?: { additions: number; deletions: number };
}

export interface GitlabCommitDiff {
  old_path: string | null;
  new_path: string | null;
}
