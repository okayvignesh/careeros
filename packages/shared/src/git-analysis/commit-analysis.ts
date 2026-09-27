// Orchestrator: given a repo's commits + files touched, produce Evidence
// rows the worker can insert. Combines language-detect, framework-hints,
// contributor-filter, and ai-assist-heuristic.
//
// Design note on Evidence shape:
//   The task-ticket taxonomy (commit_touch | framework_hint | commit_authorship)
//   is stored on `sourceRef.kind` — NOT on the schema's `kind` column. The
//   schema `kind` MUST stay one of EvidenceKind (self|document|code|...) so the
//   aggregator's RULE_BY_SIGNAL dispatch stays intact. Concretely we emit:
//     touch/hint → { kind: 'code', signal: 'presence',              weightHint }
//     authorship → { kind: 'code', signal: 'sustained-application', weightHint, streakLength }
//   The `presence` rule records the touch without touching proficiency; the
//   `sustained-application` rule bumps proficiency by log2(streak+1). Both
//   rules already existed, so no aggregator changes are needed.
//
// AI-assist confidence is used to DAMPEN weightHint: an obviously-AI commit
// still counts as evidence (author still landed the change), but at reduced
// weight so a paste-from-LLM PR does not equal hand-written code. Confidence
// is also written into detail so the UI + downstream filters can see it.

import { detectLanguage } from './language-detect.js';
import { aggregateHints, type FrameworkHint } from './framework-hints.js';
import { filterOwnCommits, type CommitLike, type KnownEmails } from './contributor-filter.js';
import { scoreCommitBatch, type CommitStat } from './ai-assist-heuristic.js';

/**
 * Minimal shape of a commit + its files touched. Both GitHub and GitLab
 * clients can shape their payloads to this without pulling more fields than
 * needed.
 */
export interface CommitWithFiles extends CommitLike, CommitStat {
  files: string[];
}

/**
 * Emitted Evidence row shape. Matches the columns the worker will write into
 * the `evidence` table via prisma.evidence.create — same shape github-sync
 * already uses today.
 */
export interface EvidenceRow {
  skillId: string;
  kind: 'code'; // schema column: EvidenceKind (see knowledge-rules)
  signal: 'presence' | 'sustained-application';
  weightHint: number; // [0..1], clamped
  sourceRef: {
    /** Taxonomy label: commit_touch | framework_hint | commit_authorship. */
    kind: 'commit_touch' | 'framework_hint' | 'commit_authorship';
    sha: string;
    /** Repository slug — github-sync passes "owner/name", gitlab passes "namespace/path". */
    repoRef: string;
    /** File path that raised the signal (touch + hint rows only). */
    path?: string;
  };
  detail: {
    aiAssistConfidence: number;
    aiAssistReasons: string[];
    reason?: string; // framework hint reason
    fileCount?: number; // framework hint aggregate
  };
  observedAt: Date;
  /** For sustained-application rows only. */
  streakLength?: number;
}

export interface AnalyzeCommitsInput {
  repoRef: string;
  commits: CommitWithFiles[];
  knownEmails: KnownEmails;
  /** Optional per-author calibration; when omitted the heuristic uses hard-coded floors. */
  authorMedianLinesChanged?: number;
  authorMedianFilesTouched?: number;
}

export interface AnalyzeCommitsResult {
  ownCommitCount: number;
  rows: EvidenceRow[];
  /** Sorted rollup for logging/telemetry — not persisted. */
  perSkillTouches: Array<{ skillId: string; touches: number }>;
}

/**
 * Analyze one repo's commits. Returns evidence rows ready to write.
 *
 * Ownership filter runs FIRST — we never emit evidence for commits whose
 * author isn't in the user's known-emails set. Everything downstream operates
 * on the filtered subset only.
 */
export function analyzeRepoCommits(input: AnalyzeCommitsInput): AnalyzeCommitsResult {
  const own = filterOwnCommits(input.commits, input.knownEmails);
  if (own.length === 0) {
    return { ownCommitCount: 0, rows: [], perSkillTouches: [] };
  }

  const aiScores = new Map(
    scoreCommitBatch(own, {
      ...(input.authorMedianLinesChanged !== undefined
        ? { authorMedianLinesChanged: input.authorMedianLinesChanged }
        : {}),
      ...(input.authorMedianFilesTouched !== undefined
        ? { authorMedianFilesTouched: input.authorMedianFilesTouched }
        : {}),
    }).map((s) => [s.sha, s]),
  );

  const rows: EvidenceRow[] = [];
  const touchCount = new Map<string, number>();
  // Group per-skill authorship counts so we can emit ONE sustained-application
  // row per (skill, repo) with a streakLength — that scales the aggregator's
  // log2 bump. Emitting one row per commit would double-count.
  const authorshipBySkill = new Map<
    string,
    { count: number; lastCommit: CommitWithFiles; aiConfidences: number[] }
  >();

  for (const commit of own) {
    const ai = aiScores.get(commit.sha) ?? { confidence: 0, reasons: [] };
    // AI-assist DAMPENS the weight but never zeros it — the code still landed
    // in the repo under this author. `code` weight is 0.7 by default; a fully
    // AI commit drops it to 0.7 * 0.4 = 0.28.
    const damp = 1 - 0.6 * ai.confidence;

    // Per-file touch evidence (commit_touch). Dedupe by (skillId, sha) so a
    // single commit that touches ten .py files raises ONE touch row for
    // python — the aggregator's presence rule doesn't care about count above 1.
    const seenPerCommit = new Set<string>();
    for (const path of commit.files) {
      const skillId = detectLanguage(path);
      if (!skillId) continue;
      if (seenPerCommit.has(skillId)) continue;
      seenPerCommit.add(skillId);
      touchCount.set(skillId, (touchCount.get(skillId) ?? 0) + 1);
      rows.push({
        skillId,
        kind: 'code',
        signal: 'presence',
        weightHint: clampUnit(0.6 * damp),
        sourceRef: {
          kind: 'commit_touch',
          sha: commit.sha,
          repoRef: input.repoRef,
          path,
        },
        detail: {
          aiAssistConfidence: ai.confidence,
          aiAssistReasons: ai.reasons,
        },
        observedAt: commit.authoredAt,
      });
    }

    // Framework hints across the commit's files. Aggregated so a commit that
    // adds `Dockerfile` + `docker-compose.yml` raises ONE docker hint row with
    // fileCount=2 instead of two.
    const hints: Array<FrameworkHint & { fileCount: number }> = aggregateHints(commit.files);
    for (const h of hints) {
      rows.push({
        skillId: h.skillId,
        kind: 'code',
        signal: 'presence',
        weightHint: clampUnit(0.55 * damp),
        sourceRef: {
          kind: 'framework_hint',
          sha: commit.sha,
          repoRef: input.repoRef,
        },
        detail: {
          aiAssistConfidence: ai.confidence,
          aiAssistReasons: ai.reasons,
          reason: h.reason,
          fileCount: h.fileCount,
        },
        observedAt: commit.authoredAt,
      });
    }

    // Roll up authorship by skill. One authorship row per (skill, repo)
    // downstream, with streakLength = number of commits under this skill.
    for (const skillId of seenPerCommit) {
      const cur = authorshipBySkill.get(skillId);
      if (cur) {
        cur.count += 1;
        cur.lastCommit = commit;
        cur.aiConfidences.push(ai.confidence);
      } else {
        authorshipBySkill.set(skillId, {
          count: 1,
          lastCommit: commit,
          aiConfidences: [ai.confidence],
        });
      }
    }
  }

  for (const [skillId, agg] of authorshipBySkill) {
    // Use the mean AI-assist confidence across the batch as the damp factor
    // for the authorship row. A single AI commit in an otherwise-human month
    // shouldn't kill the sustained-application signal.
    const meanAi = agg.aiConfidences.reduce((a, b) => a + b, 0) / agg.aiConfidences.length;
    const damp = 1 - 0.6 * meanAi;
    rows.push({
      skillId,
      kind: 'code',
      signal: 'sustained-application',
      weightHint: clampUnit(0.8 * damp),
      sourceRef: {
        kind: 'commit_authorship',
        sha: agg.lastCommit.sha,
        repoRef: input.repoRef,
      },
      detail: {
        aiAssistConfidence: meanAi,
        aiAssistReasons: [`${agg.count} commit(s) authored`],
      },
      observedAt: agg.lastCommit.authoredAt,
      streakLength: agg.count,
    });
  }

  const perSkillTouches = [...touchCount.entries()]
    .map(([skillId, touches]) => ({ skillId, touches }))
    .sort((a, b) => b.touches - a.touches);

  return { ownCommitCount: own.length, rows, perSkillTouches };
}

function clampUnit(n: number): number {
  return Math.max(0, Math.min(1, n));
}
