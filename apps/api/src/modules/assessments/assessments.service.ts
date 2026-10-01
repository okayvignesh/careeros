import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  gradeAgainstRubric,
  gradeCodeReview,
  gradeDebugging,
  gradeKnowledge,
  gradeMockInterview,
  newStreak,
  rubricHash,
  shouldRemediate,
  streakTick,
  SYSTEM_DESIGN_RUBRIC,
  xpFor,
  xpLevel,
  type CodeReviewGrade,
  type DebuggingGrade,
  type GeneratedBuildTask,
  type GeneratedCodeReview,
  type GeneratedDebuggingTask,
  type GeneratedMockInterview,
  type GeneratedQuestion,
  type GeneratedSystemDesign,
  type KnowledgeGrade,
  type LevelInfo,
  type MockInterviewGrade,
  type RubricGrade,
  type RubricGradeResponse,
} from '@careeros/shared';
import { DeepSeekProvider, renderPrompt, wrapUntrusted, type Sensitivity } from '@careeros/ai';
import { runSandboxed, type LanguageId, type SandboxResult } from '@careeros/sandbox';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { syncSkillState } from '../../common/aggregate-skill';
import { UsageService } from '../usage/usage.service';
import { UsageCache } from '../usage/usage.cache';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { makeLlmAuditor } from '../../common/llm-audit';
import { renderBuildTaskPrompt } from './prompts/build-task-generator';

const KEY = loadMasterKey();

// If per-skill eligible pool drops below this, ask the LLM for another one.
// ponytail: fixed threshold; will move to app_config if operators start pushing it.
const MIN_ELIGIBLE_POOL = 2;

export interface KnowledgeQuestion {
  id: string;
  prompt: string;
  skillIds: string[];
  difficulty: string;
  answerHint: string | null;
  sourceKind: string | null;
  sourceUrl: string | null;
  sourceAttribution: string | null;
}

export interface CodeReviewTask {
  id: string;
  diff: string;
  scenario: string;
  language: string;
  skillIds: string[];
  difficulty: string;
  defectCount: number;
}

export interface BossBattleTask {
  id: string;
  milestone: number;
  startedAt: string;
  durationS: number;
  expiresAt: string;
  status: 'active' | 'passed' | 'failed' | 'expired';
  questions: Array<{
    id: string;
    prompt: string;
    skillIds: string[];
    difficulty: string;
  }>;
}

export interface EligibleBossMilestone {
  milestone: number | null;
  currentLevel: number;
  activeBossId: string | null;
}

const BOSS_MILESTONES = [10, 25, 50, 75, 100] as const;

export interface MockInterviewQuestion {
  kind: 'technical' | 'behavioral';
  prompt: string;
  keyPoints: string[];
}

export interface MockInterviewTask {
  id: string;
  scenario: string;
  questions: MockInterviewQuestion[];
  skillIds: string[];
  difficulty: string;
}

export interface DebuggingTask {
  id: string;
  brokenCode: string;
  language: string;
  description: string;
  hint: string;
  skillIds: string[];
  difficulty: string;
}

export interface BuildTask {
  id: string;
  title: string;
  description: string;
  language: LanguageId;
  starter: string;
  timeoutMs: number;
  skillIds: string[];
  difficulty: string;
}

export interface SystemDesignTask {
  id: string;
  scenario: string;
  constraints: string[];
  skillIds: string[];
  difficulty: string;
  rubricId: string;
  rubricVersion: string;
  dimensions: Array<{ id: string; name: string }>;
}

export interface AttemptResult {
  attemptId: string;
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
  xpAwarded: number;
  totalXp: number;
  level: LevelInfo;
  previousLevel: number;
  leveledUp: boolean;
  streakDays: number;
  skillDeltas: Array<{
    skillId: string;
    beforeLevel: number;
    afterLevel: number;
    beforeProficiency: number;
    afterProficiency: number;
  }>;
}

@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  // Sandbox entry seam. Tests overwrite this field with a stub so build-task
  // grading can be exercised without Docker. ponytail: field, not constructor
  // arg; constructor signature is referenced across every assessments test file
  // and widening it is more churn than reaching in here.
  protected runSandbox: (opts: Parameters<typeof runSandboxed>[0]) => Promise<SandboxResult> =
    runSandboxed;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly usageCache: UsageCache,
    private readonly sensitivity: SensitivityGateService,
  ) {}

  async ensureSeed(): Promise<number> {
    for (const seed of KNOWLEDGE_SEED) {
      const promptHash = hashPrompt(seed.prompt);
      await this.prisma.question.upsert({
        where: { promptHash },
        create: {
          kind: 'knowledge',
          skillIds: seed.skillIds,
          difficulty: seed.difficulty,
          prompt: seed.prompt,
          keyPoints: seed.keyPoints,
          answerHint: seed.answerHint,
          promptHash,
        },
        update: {},
      });
    }
    return KNOWLEDGE_SEED.length;
  }

  /**
   * Pick a knowledge question the user hasn't seen in the cooldown window.
   * ponytail: 14-day cooldown from blueprint; walking-skeleton uses a random
   * eligible row instead of the priority-weighted `nextBestQuest` (needs the
   * priority formula that lands with market data).
   */
  async nextKnowledgeQuestion(userId: string, skillId?: string): Promise<KnowledgeQuestion> {
    await this.ensureSeed();
    const cooldownStart = new Date(Date.now() - 14 * 86_400_000);
    const recent = await this.prisma.attempt.findMany({
      where: { userId, kind: 'knowledge', createdAt: { gte: cooldownStart } },
      select: { questionId: true },
    });
    const excludeIds = recent.map((r) => r.questionId).filter((id): id is string => !!id);
    const where: { kind: string; flagged: boolean; id?: { notIn: string[] }; skillIds?: { has: string } } = {
      kind: 'knowledge',
      flagged: false,
    };
    if (excludeIds.length > 0) where.id = { notIn: excludeIds };
    if (skillId) where.skillIds = { has: skillId };
    let eligible = await this.prisma.question.findMany({ where });
    // Auto-top-up: if the eligible pool is thin for this skill, try to generate
    // one more question via the LLM before falling back to the ignore-cooldown pool.
    // Fire-and-forget when there's already something to serve; block only when empty.
    if (skillId && eligible.length < MIN_ELIGIBLE_POOL) {
      if (eligible.length === 0) {
        const gen = await this.generateKnowledgeQuestion(userId, skillId).catch(() => null);
        if (gen) {
          const row = await this.prisma.question.findUnique({ where: { id: gen.id } });
          if (row) eligible = [row];
        }
      } else {
        // ponytail: don't await; runner returns the current row immediately and
        // the next call sees the new one. Errors already swallowed inside the method.
        void this.generateKnowledgeQuestion(userId, skillId).catch(() => null);
      }
    }
    // Fallback: if everything is on cooldown, drop the exclusion so the user
    // still gets a question rather than a dead end.
    const pool =
      eligible.length > 0
        ? eligible
        : await this.prisma.question.findMany({ where: { kind: 'knowledge', flagged: false } });
    if (pool.length === 0) throw new NotFoundException('No knowledge questions available');
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    return {
      id: pick.id,
      prompt: pick.prompt,
      skillIds: pick.skillIds,
      difficulty: pick.difficulty,
      answerHint: pick.answerHint,
      sourceKind: pick.sourceKind,
      sourceUrl: pick.sourceUrl,
      sourceAttribution: pick.sourceAttribution,
    };
  }

  /**
   * LLM-generate one knowledge question for (skillId, difficulty) and upsert
   * into `question_bank`. Returns the inserted row so callers can serve it
   * immediately. Returns null instead of throwing on no-provider / paused /
   * sensitivity-gate-blocked / non-deepseek provider, so callers can fall back
   * to the hand-seeded pool without ugly try/catch. Deduped via `promptHash`.
   */
  async generateKnowledgeQuestion(
    userId: string,
    skillId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  ): Promise<KnowledgeQuestion | null> {
    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) return null;
    try {
      await this.usage.assertCallAllowed(userId);
      const cfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!cfg) return null;
      // Generator input is our own skill catalogue, no user data; `public` is correct.
      await this.sensitivity.assertAllowed(cfg.provider, 'public', userId);

      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: cfg.apiKeySecretId },
      });
      if (!secret) return null;
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);

      if (cfg.provider !== 'deepseek') return null;
      const provider = new DeepSeekProvider({
        apiKey,
        baseUrl: cfg.baseUrl ?? undefined,
        chatModel: cfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      });

      const rendered = renderPrompt('question-generator', {
        skillId: skill.id,
        skillName: skill.name,
        difficulty,
      });
      // A-M9: per-user LLM concurrency ceiling.
      const result = (await this.usage.runWithUserLimit(userId, () =>
        provider.chatStructured({
          messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user },
          ],
          schema: rendered.schema,
          temperature: 0.7,
        }),
      )) as GeneratedQuestion;

      const promptHash = hashPrompt(result.prompt);
      const row = await this.prisma.question.upsert({
        where: { promptHash },
        create: {
          kind: 'knowledge',
          skillIds: [skillId],
          difficulty: result.difficulty,
          prompt: result.prompt,
          keyPoints: result.keyPoints,
          answerHint: result.answerHint,
          promptHash,
        },
        update: {}, // Preserve the original if hash collides; a dup generation is a no-op.
      });
      return {
        id: row.id,
        prompt: row.prompt,
        skillIds: row.skillIds,
        difficulty: row.difficulty,
        answerHint: row.answerHint,
        sourceKind: row.sourceKind,
        sourceUrl: row.sourceUrl,
        sourceAttribution: row.sourceAttribution,
      };
    } catch (err) {
      this.logger.warn(`question-generator failed for skill=${skillId}: ${(err as Error).message}`);
      return null;
    }
  }

  async gradeKnowledgeAttempt(
    userId: string,
    input: { questionId: string; answer: string; durationMs?: number },
  ): Promise<AttemptResult> {
    if (typeof input.answer !== 'string' || input.answer.trim().length === 0) {
      throw new BadRequestException('answer is required');
    }
    const q = await this.prisma.question.findUnique({ where: { id: input.questionId } });
    if (!q || q.kind !== 'knowledge') {
      throw new NotFoundException('Question not found');
    }

    const grading = await this.gradeWithLlmOrFallback(userId, input.answer, q.prompt, q.keyPoints);

    const attempt = await this.prisma.attempt.create({
      data: {
        userId,
        questionId: q.id,
        kind: 'knowledge',
        score: grading.score.toFixed(3),
        reasoning: grading.reasoning,
        answerJson: { answer: input.answer },
        gradingJson: { hits: grading.hits, misses: grading.misses, grader: grading.grader },
        ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
      },
    });

    // Evidence: one row per mapped skill. Correct-hinted signal because the
    // user got points off keyPoint matches (light structural hints in a way).
    // Incorrect answers still write an evidence row using the aggregator's
    // incorrect-with-correction path so the reason log captures the miss.
    const signal = grading.score >= 0.7 ? 'correct-independent' : 'incorrect-with-correction';
    const skillDeltas: AttemptResult['skillDeltas'] = [];
    for (const skillId of q.skillIds) {
      const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
      if (!skill) continue; // skip missing skill IDs; seed drift shouldn't crash the endpoint
      const beforeState = await this.prisma.candidateSkillState.findUnique({
        where: { userId_skillId: { userId, skillId } },
      });
      await this.prisma.evidence.create({
        data: {
          userId,
          skillId,
          kind: 'assessment',
          signal,
          weightHint: grading.score.toFixed(3),
          sourceRef: { kind: 'attempt', id: attempt.id },
          detail: { questionId: q.id, hits: grading.hits, misses: grading.misses },
        },
      });
      const after = await syncSkillState(this.prisma, userId, skillId);
      skillDeltas.push({
        skillId,
        beforeLevel: beforeState?.level ?? 1,
        afterLevel: after.level,
        beforeProficiency: beforeState ? Number(beforeState.proficiency) : 0,
        afterProficiency: after.state.proficiency,
      });

      await this.reconcileRemediation(userId, skillId, skill.name, grading.score);
    }

    const xpAwarded = xpFor('knowledge', grading.score);
    await this.prisma.xpEvent.create({
      data: { userId, attemptId: attempt.id, reason: 'attempt:knowledge', xp: xpAwarded },
    });

    const [xpSum, streakState] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.tickStreak(userId, new Date()),
    ]);
    const totalXp = xpSum._sum.xp ?? 0;

    return {
      attemptId: attempt.id,
      score: grading.score,
      hits: grading.hits,
      misses: grading.misses,
      reasoning: grading.reasoning,
      xpAwarded,
      totalXp,
      ...levelChange(totalXp, xpAwarded),
      streakDays: streakState.currentDays,
      skillDeltas,
    };
  }

  async getAttempt(userId: string, id: string): Promise<AttemptResult | null> {
    const attempt = await this.prisma.attempt.findFirst({ where: { id, userId } });
    if (!attempt) return null;
    const question = attempt.questionId
      ? await this.prisma.question.findUnique({ where: { id: attempt.questionId } })
      : null;
    const grading = attempt.gradingJson as { hits?: string[]; misses?: string[] } | null;
    const [xpSum, xpForThisAttempt, streak] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.prisma.xpEvent.findFirst({ where: { attemptId: id } }),
      this.prisma.streak.findUnique({ where: { userId } }),
    ]);
    const totalXp = xpSum._sum.xp ?? 0;
    const xpAwarded = xpForThisAttempt?.xp ?? 0;
    return {
      attemptId: attempt.id,
      score: Number(attempt.score),
      hits: grading?.hits ?? [],
      misses: grading?.misses ?? [],
      reasoning: attempt.reasoning ?? '',
      xpAwarded,
      totalXp,
      ...levelChange(totalXp, xpAwarded),
      streakDays: streak?.currentDays ?? 0,
      skillDeltas: (question?.skillIds ?? []).map((skillId) => ({
        skillId,
        beforeLevel: 0,
        afterLevel: 0,
        beforeProficiency: 0,
        afterProficiency: 0,
      })),
    };
  }

  /**
   * Daily XP totals over the last N days. Used by the Progression screen chart.
   * Fills empty days with 0 so the chart doesn't visually skip.
   */
  async getXpTimeseries(userId: string, days: number): Promise<Array<{ date: string; xp: number }>> {
    const clamped = Math.max(1, Math.min(days, 90));
    const from = new Date(Date.now() - clamped * 86_400_000);
    from.setUTCHours(0, 0, 0, 0);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ bucket: Date; xp: bigint }>>(
      `SELECT date_trunc('day', "createdAt") AS bucket, COALESCE(SUM(xp), 0)::bigint AS xp
       FROM xp_events
       WHERE "userId" = $1::uuid AND "createdAt" >= $2
       GROUP BY 1
       ORDER BY 1 ASC`,
      userId,
      from,
    );
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.bucket.toISOString().slice(0, 10), Number(r.xp));
    const out: Array<{ date: string; xp: number }> = [];
    for (let i = 0; i < clamped; i++) {
      const d = new Date(from.getTime() + i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      out.push({ date: key, xp: byDate.get(key) ?? 0 });
    }
    return out;
  }

  async getProgression(userId: string) {
    const [xpSum, streak, recentXp, attempts] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.prisma.streak.findUnique({ where: { userId } }),
      this.prisma.xpEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.attempt.count({ where: { userId } }),
    ]);
    const totalXp = xpSum._sum.xp ?? 0;
    return {
      totalXp,
      level: xpLevel(totalXp),
      streakDays: streak?.currentDays ?? 0,
      longestStreakDays: streak?.longestDays ?? 0,
      attemptsTotal: attempts,
      recentXp: recentXp.map((r) => ({
        id: r.id,
        reason: r.reason,
        xp: r.xp,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Pick a code-review task the user hasn't seen in the cooldown window.
   * Same 14-day cooldown + auto-top-up shape as knowledge; no hand-seeded
   * corpus — the LLM produces tasks on demand, cached in `question_bank`.
   */
  async nextCodeReviewTask(userId: string, skillId?: string): Promise<CodeReviewTask> {
    const cooldownStart = new Date(Date.now() - 14 * 86_400_000);
    const recent = await this.prisma.attempt.findMany({
      where: { userId, kind: 'code-review', createdAt: { gte: cooldownStart } },
      select: { questionId: true },
    });
    const excludeIds = recent.map((r) => r.questionId).filter((id): id is string => !!id);
    const where: { kind: string; flagged: boolean; id?: { notIn: string[] }; skillIds?: { has: string } } = {
      kind: 'code-review',
      flagged: false,
    };
    if (excludeIds.length > 0) where.id = { notIn: excludeIds };
    if (skillId) where.skillIds = { has: skillId };
    let eligible = await this.prisma.question.findMany({ where });
    if (skillId && eligible.length < MIN_ELIGIBLE_POOL) {
      if (eligible.length === 0) {
        const gen = await this.generateCodeReviewTask(userId, skillId).catch(() => null);
        if (gen) {
          const row = await this.prisma.question.findUnique({ where: { id: gen.id } });
          if (row) eligible = [row];
        }
      } else {
        void this.generateCodeReviewTask(userId, skillId).catch(() => null);
      }
    }
    const pool =
      eligible.length > 0
        ? eligible
        : await this.prisma.question.findMany({ where: { kind: 'code-review', flagged: false } });
    if (pool.length === 0) throw new NotFoundException('No code-review tasks available');
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const meta = (pick.answerHint ?? '{}') as string;
    const parsed = safeJson<{ language?: string; scenario?: string }>(meta);
    return {
      id: pick.id,
      diff: pick.prompt,
      scenario: parsed?.scenario ?? '',
      language: parsed?.language ?? 'unknown',
      skillIds: pick.skillIds,
      difficulty: pick.difficulty,
      defectCount: pick.keyPoints.length,
    };
  }

  /**
   * LLM-generate one code-review task for (skillId, difficulty) and upsert into
   * `question_bank`. Returns null on no-provider / paused / gated so callers
   * fall back to the existing pool. Deduped via `promptHash` on the diff.
   */
  async generateCodeReviewTask(
    userId: string,
    skillId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  ): Promise<CodeReviewTask | null> {
    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) return null;
    try {
      await this.usage.assertCallAllowed(userId);
      const cfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!cfg) return null;
      // Generator input is our own skill catalogue, no user data; `public` is correct.
      await this.sensitivity.assertAllowed(cfg.provider, 'public', userId);

      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: cfg.apiKeySecretId },
      });
      if (!secret) return null;
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);

      if (cfg.provider !== 'deepseek') return null;
      const provider = new DeepSeekProvider({
        apiKey,
        baseUrl: cfg.baseUrl ?? undefined,
        chatModel: cfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      });

      const rendered = renderPrompt('code-review-generator', {
        skillId: skill.id,
        skillName: skill.name,
        difficulty,
      });
      // A-M9: per-user LLM concurrency ceiling.
      const result = (await this.usage.runWithUserLimit(userId, () =>
        provider.chatStructured({
          messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user },
          ],
          schema: rendered.schema,
          temperature: 0.7,
        }),
      )) as GeneratedCodeReview;

      const promptHash = hashPrompt(result.diff);
      const row = await this.prisma.question.upsert({
        where: { promptHash },
        create: {
          kind: 'code-review',
          skillIds: [skillId],
          difficulty: result.difficulty,
          prompt: result.diff,
          keyPoints: result.defects,
          answerHint: JSON.stringify({ language: result.language, scenario: result.scenario }),
          promptHash,
        },
        update: {},
      });
      return {
        id: row.id,
        diff: row.prompt,
        scenario: result.scenario,
        language: result.language,
        skillIds: row.skillIds,
        difficulty: row.difficulty,
        defectCount: row.keyPoints.length,
      };
    } catch (err) {
      this.logger.warn(`code-review-generator failed for skill=${skillId}: ${(err as Error).message}`);
      return null;
    }
  }

  async gradeCodeReviewAttempt(
    userId: string,
    input: { questionId: string; findings: string[]; durationMs?: number },
  ): Promise<AttemptResult> {
    if (!Array.isArray(input.findings) || input.findings.length === 0) {
      throw new BadRequestException('findings is required');
    }
    const q = await this.prisma.question.findUnique({ where: { id: input.questionId } });
    if (!q || q.kind !== 'code-review') {
      throw new NotFoundException('Task not found');
    }

    const grading = await this.gradeReviewWithLlmOrFallback(userId, input.findings, q.prompt, q.keyPoints);

    const attempt = await this.prisma.attempt.create({
      data: {
        userId,
        questionId: q.id,
        kind: 'code-review',
        score: grading.score.toFixed(3),
        reasoning: grading.reasoning,
        answerJson: { findings: input.findings },
        gradingJson: {
          hits: grading.hits,
          misses: grading.misses,
          falsePositives: grading.falsePositives,
          precision: grading.precision,
          recall: grading.recall,
          grader: grading.grader,
        },
        ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
      },
    });

    const signal = grading.score >= 0.7 ? 'correct-independent' : 'incorrect-with-correction';
    const skillDeltas: AttemptResult['skillDeltas'] = [];
    for (const skillId of q.skillIds) {
      const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
      if (!skill) continue;
      const beforeState = await this.prisma.candidateSkillState.findUnique({
        where: { userId_skillId: { userId, skillId } },
      });
      await this.prisma.evidence.create({
        data: {
          userId,
          skillId,
          kind: 'assessment',
          signal,
          weightHint: grading.score.toFixed(3),
          sourceRef: { kind: 'attempt', id: attempt.id },
          detail: {
            questionId: q.id,
            hits: grading.hits,
            misses: grading.misses,
            precision: grading.precision,
            recall: grading.recall,
          },
        },
      });
      const after = await syncSkillState(this.prisma, userId, skillId);
      skillDeltas.push({
        skillId,
        beforeLevel: beforeState?.level ?? 1,
        afterLevel: after.level,
        beforeProficiency: beforeState ? Number(beforeState.proficiency) : 0,
        afterProficiency: after.state.proficiency,
      });
      await this.reconcileRemediation(userId, skillId, skill.name, grading.score);
    }

    const xpAwarded = xpFor('code-review', grading.score);
    await this.prisma.xpEvent.create({
      data: { userId, attemptId: attempt.id, reason: 'attempt:code-review', xp: xpAwarded },
    });

    const [xpSum, streakState] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.tickStreak(userId, new Date()),
    ]);
    const totalXp = xpSum._sum.xp ?? 0;

    return {
      attemptId: attempt.id,
      score: grading.score,
      hits: grading.hits,
      misses: grading.misses,
      reasoning: grading.reasoning,
      xpAwarded,
      totalXp,
      ...levelChange(totalXp, xpAwarded),
      streakDays: streakState.currentDays,
      skillDeltas,
    };
  }

  /**
   * Pick a system-design task the user hasn't seen in the cooldown window.
   * Same shape as code-review; no hand-seeded corpus — LLM produces tasks on
   * demand, dimensions come from `SYSTEM_DESIGN_RUBRIC`.
   */
  async nextSystemDesignTask(userId: string, skillId?: string): Promise<SystemDesignTask> {
    const cooldownStart = new Date(Date.now() - 14 * 86_400_000);
    const recent = await this.prisma.attempt.findMany({
      where: { userId, kind: 'system-design', createdAt: { gte: cooldownStart } },
      select: { questionId: true },
    });
    const excludeIds = recent.map((r) => r.questionId).filter((id): id is string => !!id);
    const where: { kind: string; flagged: boolean; id?: { notIn: string[] }; skillIds?: { has: string } } = {
      kind: 'system-design',
      flagged: false,
    };
    if (excludeIds.length > 0) where.id = { notIn: excludeIds };
    if (skillId) where.skillIds = { has: skillId };
    let eligible = await this.prisma.question.findMany({ where });
    const seedSkill = skillId ?? 'system-design';
    if (eligible.length < MIN_ELIGIBLE_POOL) {
      if (eligible.length === 0) {
        const gen = await this.generateSystemDesignTask(userId, seedSkill).catch(() => null);
        if (gen) {
          const row = await this.prisma.question.findUnique({ where: { id: gen.id } });
          if (row) eligible = [row];
        }
      } else {
        void this.generateSystemDesignTask(userId, seedSkill).catch(() => null);
      }
    }
    const pool =
      eligible.length > 0
        ? eligible
        : await this.prisma.question.findMany({ where: { kind: 'system-design', flagged: false } });
    if (pool.length === 0) throw new NotFoundException('No system-design tasks available');
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const meta = safeJson<{ constraints?: string[] }>(pick.answerHint ?? '{}');
    return {
      id: pick.id,
      scenario: pick.prompt,
      constraints: meta?.constraints ?? [],
      skillIds: pick.skillIds,
      difficulty: pick.difficulty,
      rubricId: SYSTEM_DESIGN_RUBRIC.id,
      rubricVersion: rubricHash(SYSTEM_DESIGN_RUBRIC),
      dimensions: SYSTEM_DESIGN_RUBRIC.dimensions.map((d) => ({ id: d.id, name: d.name })),
    };
  }

  async generateSystemDesignTask(
    userId: string,
    skillId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  ): Promise<SystemDesignTask | null> {
    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) return null;
    try {
      await this.usage.assertCallAllowed(userId);
      const cfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!cfg) return null;
      await this.sensitivity.assertAllowed(cfg.provider, 'public', userId);

      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: cfg.apiKeySecretId },
      });
      if (!secret) return null;
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);

      if (cfg.provider !== 'deepseek') return null;
      const provider = new DeepSeekProvider({
        apiKey,
        baseUrl: cfg.baseUrl ?? undefined,
        chatModel: cfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      });

      const rendered = renderPrompt('system-design-generator', {
        skillId: skill.id,
        skillName: skill.name,
        difficulty,
      });
      // A-M9: per-user LLM concurrency ceiling.
      const result = (await this.usage.runWithUserLimit(userId, () =>
        provider.chatStructured({
          messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user },
          ],
          schema: rendered.schema,
          temperature: 0.7,
        }),
      )) as GeneratedSystemDesign;

      const promptHash = hashPrompt(result.scenario);
      const row = await this.prisma.question.upsert({
        where: { promptHash },
        create: {
          kind: 'system-design',
          skillIds: [skillId],
          difficulty: result.difficulty,
          prompt: result.scenario,
          keyPoints: SYSTEM_DESIGN_RUBRIC.dimensions.map((d) => d.id),
          answerHint: JSON.stringify({ constraints: result.constraints }),
          promptHash,
        },
        update: {},
      });
      return {
        id: row.id,
        scenario: row.prompt,
        constraints: result.constraints,
        skillIds: row.skillIds,
        difficulty: row.difficulty,
        rubricId: SYSTEM_DESIGN_RUBRIC.id,
        rubricVersion: rubricHash(SYSTEM_DESIGN_RUBRIC),
        dimensions: SYSTEM_DESIGN_RUBRIC.dimensions.map((d) => ({ id: d.id, name: d.name })),
      };
    } catch (err) {
      this.logger.warn(`system-design-generator failed for skill=${skillId}: ${(err as Error).message}`);
      return null;
    }
  }

  async gradeSystemDesignAttempt(
    userId: string,
    input: { questionId: string; design: string; durationMs?: number },
  ): Promise<AttemptResult> {
    if (typeof input.design !== 'string' || input.design.trim().length === 0) {
      throw new BadRequestException('design is required');
    }
    const q = await this.prisma.question.findUnique({ where: { id: input.questionId } });
    if (!q || q.kind !== 'system-design') {
      throw new NotFoundException('Task not found');
    }
    const constraints = safeJson<{ constraints?: string[] }>(q.answerHint ?? '{}')?.constraints ?? [];
    const version = rubricHash(SYSTEM_DESIGN_RUBRIC);

    const grading = await this.gradeSystemDesignWithLlmOrFallback(userId, input.design, q.prompt, constraints);

    // Score bound to the rubric version present at grade time — persists on
    // gradingJson so historical attempts can be replayed against their rubric.
    const attempt = await this.prisma.attempt.create({
      data: {
        userId,
        questionId: q.id,
        kind: 'system-design',
        score: grading.score.toFixed(3),
        reasoning: grading.reasoning,
        answerJson: { design: input.design },
        gradingJson: {
          rubricId: SYSTEM_DESIGN_RUBRIC.id,
          rubricVersion: version,
          dimensions: grading.dimensions as unknown as Prisma.InputJsonValue,
          grader: grading.grader,
        },
        ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
      },
    });

    const signal = grading.score >= 0.7 ? 'correct-independent' : 'incorrect-with-correction';
    const skillDeltas: AttemptResult['skillDeltas'] = [];
    for (const skillId of q.skillIds) {
      const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
      if (!skill) continue;
      const beforeState = await this.prisma.candidateSkillState.findUnique({
        where: { userId_skillId: { userId, skillId } },
      });
      await this.prisma.evidence.create({
        data: {
          userId,
          skillId,
          kind: 'assessment',
          signal,
          weightHint: grading.score.toFixed(3),
          sourceRef: { kind: 'attempt', id: attempt.id },
          detail: {
            questionId: q.id,
            rubricVersion: version,
            dimensions: grading.dimensions as unknown as Prisma.InputJsonValue,
          },
        },
      });
      const after = await syncSkillState(this.prisma, userId, skillId);
      skillDeltas.push({
        skillId,
        beforeLevel: beforeState?.level ?? 1,
        afterLevel: after.level,
        beforeProficiency: beforeState ? Number(beforeState.proficiency) : 0,
        afterProficiency: after.state.proficiency,
      });
      await this.reconcileRemediation(userId, skillId, skill.name, grading.score);
    }

    const xpAwarded = xpFor('system-design', grading.score);
    await this.prisma.xpEvent.create({
      data: { userId, attemptId: attempt.id, reason: 'attempt:system-design', xp: xpAwarded },
    });

    const [xpSum, streakState] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.tickStreak(userId, new Date()),
    ]);
    const totalXp = xpSum._sum.xp ?? 0;

    // AttemptResult carries hits/misses; repurpose them to show which dimensions
    // hit level >=4 (hits) vs. <=2 (misses). Result UI surfaces this as-is.
    const hits = grading.dimensions.filter((d) => d.score >= 4).map((d) => `${d.dimensionId}: ${d.score}/5`);
    const misses = grading.dimensions.filter((d) => d.score <= 2).map((d) => `${d.dimensionId}: ${d.score}/5`);

    return {
      attemptId: attempt.id,
      score: grading.score,
      hits,
      misses,
      reasoning: grading.reasoning,
      xpAwarded,
      totalXp,
      ...levelChange(totalXp, xpAwarded),
      streakDays: streakState.currentDays,
      skillDeltas,
    };
  }

  /**
   * Shared scaffold for "LLM grader with rule-based fallback". Fires the fallback
   * when: no provider configured / call disallowed by usage limits / sensitivity
   * gate blocks / secret missing / provider not deepseek / provider throws.
   * Every caller supplies a prompt id, its template variables, the sensitivity
   * label appropriate for the user text in `vars`, and a fallback thunk. The
   * `grader` tag on the return tells the attempt persist layer which path won.
   */
  private async runLlmGraderOrFallback<T extends object>(
    userId: string,
    cfg: {
      promptId: string;
      vars: Record<string, string>;
      sensitivity: Sensitivity;
      fallback: () => T;
    },
  ): Promise<T & { grader: 'llm' | 'rule' }> {
    const withFallback = (): T & { grader: 'llm' | 'rule' } =>
      Object.assign(cfg.fallback(), { grader: 'rule' as const });
    try {
      await this.usage.assertCallAllowed(userId);
      const providerCfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!providerCfg) return withFallback();
      await this.sensitivity.assertAllowed(providerCfg.provider, cfg.sensitivity, userId);

      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: providerCfg.apiKeySecretId },
      });
      if (!secret) return withFallback();
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${providerCfg.provider}:apiKey`);
      if (providerCfg.provider !== 'deepseek') return withFallback();

      const provider = new DeepSeekProvider({
        apiKey,
        baseUrl: providerCfg.baseUrl ?? undefined,
        chatModel: providerCfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      });
      const rendered = renderPrompt(cfg.promptId, cfg.vars);
      // A-M9: per-user LLM concurrency ceiling.
      const result = (await this.usage.runWithUserLimit(userId, () =>
        provider.chatStructured({
          messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user },
          ],
          schema: rendered.schema,
          temperature: 0,
        }),
      )) as T;
      return Object.assign(result, { grader: 'llm' as const });
    } catch (err) {
      this.logger.warn(`LLM grader ${cfg.promptId} failed, using rule fallback: ${(err as Error).message}`);
      return withFallback();
    }
  }

  /**
   * LLM rubric grader with rule-based fallback. Same shape as the other two
   * (knowledge / code-review) — bail to `gradeAgainstRubric` on any failure.
   */
  private async gradeSystemDesignWithLlmOrFallback(
    userId: string,
    design: string,
    scenario: string,
    constraints: string[],
  ): Promise<RubricGrade & { grader: 'llm' | 'rule' }> {
    const wrapped = wrapUntrusted(design, 'user-input');
    const rubricRendered = SYSTEM_DESIGN_RUBRIC.dimensions
      .map((d) => {
        const levels = Object.entries(d.descriptors)
          .map(([lv, txt]) => `    ${lv}. ${txt}`)
          .join('\n');
        return `- ${d.id} (${d.name}):\n${levels}`;
      })
      .join('\n');
    const raw = await this.runLlmGraderOrFallback<RubricGradeResponse>(userId, {
      promptId: 'system-design-grader',
      vars: {
        scenario,
        constraints: constraints.map((c) => `- ${c}`).join('\n') || '- (none)',
        rubric: rubricRendered,
        design: wrapped.content,
      },
      sensitivity: 'personal',
      fallback: () => gradeAgainstRubric(design, SYSTEM_DESIGN_RUBRIC) as unknown as RubricGradeResponse,
    });
    // Coerce integer schema level back into the RubricLevel union.
    const dimensions: RubricGrade['dimensions'] = raw.dimensions.map((d) => ({
      dimensionId: d.dimensionId,
      score: Math.max(1, Math.min(5, d.score)) as RubricGrade['dimensions'][number]['score'],
      notes: d.notes,
    }));
    return { score: raw.score, dimensions, reasoning: raw.reasoning, grader: raw.grader };
  }

  /**
   * Pick a debugging task the user hasn't seen in the cooldown window.
   * Reuses `question` with kind='debugging' — brokenCode in `prompt`, rootCause
   * in `keyPoints[0]`, `{language, description, hint}` JSON in `answerHint`.
   */
  async nextDebuggingTask(userId: string, skillId?: string): Promise<DebuggingTask> {
    const cooldownStart = new Date(Date.now() - 14 * 86_400_000);
    const recent = await this.prisma.attempt.findMany({
      where: { userId, kind: 'debugging', createdAt: { gte: cooldownStart } },
      select: { questionId: true },
    });
    const excludeIds = recent.map((r) => r.questionId).filter((id): id is string => !!id);
    const where: { kind: string; flagged: boolean; id?: { notIn: string[] }; skillIds?: { has: string } } = {
      kind: 'debugging',
      flagged: false,
    };
    if (excludeIds.length > 0) where.id = { notIn: excludeIds };
    if (skillId) where.skillIds = { has: skillId };
    let eligible = await this.prisma.question.findMany({ where });
    if (skillId && eligible.length < MIN_ELIGIBLE_POOL) {
      if (eligible.length === 0) {
        const gen = await this.generateDebuggingTask(userId, skillId).catch(() => null);
        if (gen) {
          const row = await this.prisma.question.findUnique({ where: { id: gen.id } });
          if (row) eligible = [row];
        }
      } else {
        void this.generateDebuggingTask(userId, skillId).catch(() => null);
      }
    }
    const pool =
      eligible.length > 0
        ? eligible
        : await this.prisma.question.findMany({ where: { kind: 'debugging', flagged: false } });
    if (pool.length === 0) throw new NotFoundException('No debugging tasks available');
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const meta = safeJson<{ language?: string; description?: string; hint?: string }>(pick.answerHint ?? '{}');
    return {
      id: pick.id,
      brokenCode: pick.prompt,
      language: meta?.language ?? 'unknown',
      description: meta?.description ?? '',
      hint: meta?.hint ?? '',
      skillIds: pick.skillIds,
      difficulty: pick.difficulty,
    };
  }

  async generateDebuggingTask(
    userId: string,
    skillId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  ): Promise<DebuggingTask | null> {
    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) return null;
    try {
      await this.usage.assertCallAllowed(userId);
      const cfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!cfg) return null;
      await this.sensitivity.assertAllowed(cfg.provider, 'public', userId);

      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: cfg.apiKeySecretId },
      });
      if (!secret) return null;
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);

      if (cfg.provider !== 'deepseek') return null;
      const provider = new DeepSeekProvider({
        apiKey,
        baseUrl: cfg.baseUrl ?? undefined,
        chatModel: cfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      });

      const rendered = renderPrompt('debugging-task-generator', {
        skillId: skill.id,
        skillName: skill.name,
        difficulty,
      });
      // A-M9: per-user LLM concurrency ceiling.
      const result = (await this.usage.runWithUserLimit(userId, () =>
        provider.chatStructured({
          messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user },
          ],
          schema: rendered.schema,
          temperature: 0.7,
        }),
      )) as GeneratedDebuggingTask;

      const promptHash = hashPrompt(result.brokenCode);
      const row = await this.prisma.question.upsert({
        where: { promptHash },
        create: {
          kind: 'debugging',
          skillIds: [skillId],
          difficulty: result.difficulty,
          prompt: result.brokenCode,
          keyPoints: [result.rootCause],
          answerHint: JSON.stringify({
            language: result.language,
            description: result.description,
            hint: result.hint,
          }),
          promptHash,
        },
        update: {},
      });
      return {
        id: row.id,
        brokenCode: row.prompt,
        language: result.language,
        description: result.description,
        hint: result.hint,
        skillIds: row.skillIds,
        difficulty: row.difficulty,
      };
    } catch (err) {
      this.logger.warn(`debugging-task-generator failed for skill=${skillId}: ${(err as Error).message}`);
      return null;
    }
  }

  async gradeDebuggingAttempt(
    userId: string,
    input: { questionId: string; fix: string; durationMs?: number },
  ): Promise<AttemptResult> {
    if (typeof input.fix !== 'string' || input.fix.trim().length === 0) {
      throw new BadRequestException('fix is required');
    }
    const q = await this.prisma.question.findUnique({ where: { id: input.questionId } });
    if (!q || q.kind !== 'debugging') {
      throw new NotFoundException('Task not found');
    }
    const meta = safeJson<{ description?: string }>(q.answerHint ?? '{}');
    const description = meta?.description ?? '';
    const rootCause = q.keyPoints[0] ?? '';

    const grading = await this.gradeDebuggingWithLlmOrFallback(userId, input.fix, q.prompt, rootCause, description);

    const attempt = await this.prisma.attempt.create({
      data: {
        userId,
        questionId: q.id,
        kind: 'debugging',
        score: grading.score.toFixed(3),
        reasoning: grading.reasoning,
        answerJson: { fix: input.fix },
        gradingJson: {
          correctness: grading.correctness,
          minimality: grading.minimality,
          grader: grading.grader,
        },
        ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
      },
    });

    const signal = grading.score >= 0.7 ? 'correct-independent' : 'incorrect-with-correction';
    const skillDeltas: AttemptResult['skillDeltas'] = [];
    for (const skillId of q.skillIds) {
      const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
      if (!skill) continue;
      const beforeState = await this.prisma.candidateSkillState.findUnique({
        where: { userId_skillId: { userId, skillId } },
      });
      await this.prisma.evidence.create({
        data: {
          userId,
          skillId,
          kind: 'assessment',
          signal,
          weightHint: grading.score.toFixed(3),
          sourceRef: { kind: 'attempt', id: attempt.id },
          detail: {
            questionId: q.id,
            correctness: grading.correctness,
            minimality: grading.minimality,
          },
        },
      });
      const after = await syncSkillState(this.prisma, userId, skillId);
      skillDeltas.push({
        skillId,
        beforeLevel: beforeState?.level ?? 1,
        afterLevel: after.level,
        beforeProficiency: beforeState ? Number(beforeState.proficiency) : 0,
        afterProficiency: after.state.proficiency,
      });
      await this.reconcileRemediation(userId, skillId, skill.name, grading.score);
    }

    const xpAwarded = xpFor('debugging', grading.score);
    await this.prisma.xpEvent.create({
      data: { userId, attemptId: attempt.id, reason: 'attempt:debugging', xp: xpAwarded },
    });

    const [xpSum, streakState] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.tickStreak(userId, new Date()),
    ]);
    const totalXp = xpSum._sum.xp ?? 0;

    // Reuse AttemptResult hits/misses to surface the two component scores.
    const hits: string[] = [];
    const misses: string[] = [];
    if (grading.correctness >= 0.7) hits.push(`correctness ${(grading.correctness * 100).toFixed(0)}%`);
    else misses.push(`correctness ${(grading.correctness * 100).toFixed(0)}%`);
    if (grading.minimality >= 0.7) hits.push(`minimality ${(grading.minimality * 100).toFixed(0)}%`);
    else misses.push(`minimality ${(grading.minimality * 100).toFixed(0)}%`);

    return {
      attemptId: attempt.id,
      score: grading.score,
      hits,
      misses,
      reasoning: grading.reasoning,
      xpAwarded,
      totalXp,
      ...levelChange(totalXp, xpAwarded),
      streakDays: streakState.currentDays,
      skillDeltas,
    };
  }

  private async gradeDebuggingWithLlmOrFallback(
    userId: string,
    fix: string,
    brokenCode: string,
    rootCause: string,
    description: string,
  ): Promise<DebuggingGrade & { grader: 'llm' | 'rule' }> {
    const wrapped = wrapUntrusted(fix, 'user-input');
    return this.runLlmGraderOrFallback<DebuggingGrade>(userId, {
      promptId: 'debugging-task-grader',
      vars: { description, brokenCode, rootCause, fix: wrapped.content },
      sensitivity: 'personal',
      fallback: () => gradeDebugging(brokenCode, fix, rootCause),
    });
  }

  /**
   * Pick a mock-interview batch the user hasn't seen in the cooldown window.
   * Walking-skeleton: single-turn 3-question batch (2 technical + 1 behavioral)
   * stored on `question` (kind='mock-interview'). The 3-question shape lives
   * in `answerHint` JSON since `keyPoints[]` is per-batch-first-Q only for
   * compat with legacy readers; the runner + grader use the JSON.
   */
  async nextMockInterview(userId: string, skillId?: string): Promise<MockInterviewTask> {
    const cooldownStart = new Date(Date.now() - 14 * 86_400_000);
    const recent = await this.prisma.attempt.findMany({
      where: { userId, kind: 'mock-interview', createdAt: { gte: cooldownStart } },
      select: { questionId: true },
    });
    const excludeIds = recent.map((r) => r.questionId).filter((id): id is string => !!id);
    const where: { kind: string; flagged: boolean; id?: { notIn: string[] }; skillIds?: { has: string } } = {
      kind: 'mock-interview',
      flagged: false,
    };
    if (excludeIds.length > 0) where.id = { notIn: excludeIds };
    if (skillId) where.skillIds = { has: skillId };
    let eligible = await this.prisma.question.findMany({ where });
    if (skillId && eligible.length < MIN_ELIGIBLE_POOL) {
      if (eligible.length === 0) {
        const gen = await this.generateMockInterview(userId, skillId).catch(() => null);
        if (gen) {
          const row = await this.prisma.question.findUnique({ where: { id: gen.id } });
          if (row) eligible = [row];
        }
      } else {
        void this.generateMockInterview(userId, skillId).catch(() => null);
      }
    }
    const pool =
      eligible.length > 0
        ? eligible
        : await this.prisma.question.findMany({ where: { kind: 'mock-interview', flagged: false } });
    if (pool.length === 0) throw new NotFoundException('No mock-interview tasks available');
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const meta =
      safeJson<{ scenario?: string; questions?: MockInterviewQuestion[] }>(pick.answerHint ?? '{}') ?? {};
    return {
      id: pick.id,
      scenario: meta.scenario ?? '',
      questions: meta.questions ?? [],
      skillIds: pick.skillIds,
      difficulty: pick.difficulty,
    };
  }

  async generateMockInterview(
    userId: string,
    skillId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  ): Promise<MockInterviewTask | null> {
    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) return null;
    try {
      await this.usage.assertCallAllowed(userId);
      const cfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!cfg) return null;
      await this.sensitivity.assertAllowed(cfg.provider, 'public', userId);

      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: cfg.apiKeySecretId },
      });
      if (!secret) return null;
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);
      if (cfg.provider !== 'deepseek') return null;

      const provider = new DeepSeekProvider({
        apiKey,
        baseUrl: cfg.baseUrl ?? undefined,
        chatModel: cfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      });

      const rendered = renderPrompt('mock-interview-generator', {
        skillId: skill.id,
        skillName: skill.name,
        difficulty,
      });
      // A-M9: per-user LLM concurrency ceiling.
      const result = (await this.usage.runWithUserLimit(userId, () =>
        provider.chatStructured({
          messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user },
          ],
          schema: rendered.schema,
          temperature: 0.7,
        }),
      )) as GeneratedMockInterview;

      const promptHash = hashPrompt(result.scenario + result.questions.map((q) => q.prompt).join('|'));
      const row = await this.prisma.question.upsert({
        where: { promptHash },
        create: {
          kind: 'mock-interview',
          skillIds: [skillId],
          difficulty: result.difficulty,
          prompt: result.scenario,
          keyPoints: result.questions[0]?.keyPoints ?? [],
          answerHint: JSON.stringify({ scenario: result.scenario, questions: result.questions }),
          promptHash,
        },
        update: {},
      });
      return {
        id: row.id,
        scenario: result.scenario,
        questions: result.questions,
        skillIds: row.skillIds,
        difficulty: row.difficulty,
      };
    } catch (err) {
      this.logger.warn(`mock-interview-generator failed for skill=${skillId}: ${(err as Error).message}`);
      return null;
    }
  }

  async gradeMockInterviewAttempt(
    userId: string,
    input: { questionId: string; answers: string[]; durationMs?: number },
  ): Promise<AttemptResult> {
    if (!Array.isArray(input.answers) || input.answers.length !== 3) {
      throw new BadRequestException('answers must be an array of exactly 3 strings');
    }
    const q = await this.prisma.question.findUnique({ where: { id: input.questionId } });
    if (!q || q.kind !== 'mock-interview') {
      throw new NotFoundException('Task not found');
    }
    const meta =
      safeJson<{ scenario?: string; questions?: MockInterviewQuestion[] }>(q.answerHint ?? '{}') ?? {};
    const questions = meta.questions ?? [];
    if (questions.length !== 3) {
      throw new BadRequestException('Task is malformed: expected 3 questions');
    }
    const scenario = meta.scenario ?? '';

    const grading = await this.gradeMockInterviewWithLlmOrFallback(userId, input.answers, scenario, questions);

    const attempt = await this.prisma.attempt.create({
      data: {
        userId,
        questionId: q.id,
        kind: 'mock-interview',
        score: grading.score.toFixed(3),
        reasoning: grading.reasoning,
        answerJson: { answers: input.answers },
        gradingJson: {
          questions: grading.questions as unknown as Prisma.InputJsonValue,
          grader: grading.grader,
        },
        ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
      },
    });

    const signal = grading.score >= 0.7 ? 'correct-independent' : 'incorrect-with-correction';
    const skillDeltas: AttemptResult['skillDeltas'] = [];
    for (const skillId of q.skillIds) {
      const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
      if (!skill) continue;
      const beforeState = await this.prisma.candidateSkillState.findUnique({
        where: { userId_skillId: { userId, skillId } },
      });
      await this.prisma.evidence.create({
        data: {
          userId,
          skillId,
          kind: 'assessment',
          signal,
          weightHint: grading.score.toFixed(3),
          sourceRef: { kind: 'attempt', id: attempt.id },
          detail: {
            questionId: q.id,
            perQuestion: grading.questions as unknown as Prisma.InputJsonValue,
          },
        },
      });
      const after = await syncSkillState(this.prisma, userId, skillId);
      skillDeltas.push({
        skillId,
        beforeLevel: beforeState?.level ?? 1,
        afterLevel: after.level,
        beforeProficiency: beforeState ? Number(beforeState.proficiency) : 0,
        afterProficiency: after.state.proficiency,
      });
      await this.reconcileRemediation(userId, skillId, skill.name, grading.score);
    }

    const xpAwarded = xpFor('mock-interview', grading.score);
    await this.prisma.xpEvent.create({
      data: { userId, attemptId: attempt.id, reason: 'attempt:mock-interview', xp: xpAwarded },
    });

    const [xpSum, streakState] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.tickStreak(userId, new Date()),
    ]);
    const totalXp = xpSum._sum.xp ?? 0;

    // Reuse AttemptResult hits/misses to surface per-question pass/fail summary.
    const hits = grading.questions.filter((qg) => qg.score >= 0.7).map((qg) => `Q${qg.index + 1}: ${(qg.score * 100).toFixed(0)}%`);
    const misses = grading.questions.filter((qg) => qg.score < 0.7).map((qg) => `Q${qg.index + 1}: ${(qg.score * 100).toFixed(0)}%`);

    return {
      attemptId: attempt.id,
      score: grading.score,
      hits,
      misses,
      reasoning: grading.reasoning,
      xpAwarded,
      totalXp,
      ...levelChange(totalXp, xpAwarded),
      streakDays: streakState.currentDays,
      skillDeltas,
    };
  }

  /**
   * Pick a build task the user hasn't seen in the cooldown window. Reuses
   * `question` with kind='build': `description` in `prompt`, hidden `tests`
   * in `keyPoints[0]`, `{language, title, starter, timeoutMs}` JSON in
   * `answerHint`. On empty pool with no LLM provider, falls back to the
   * hand-seeded set (same shape as `KNOWLEDGE_SEED`).
   */
  async nextBuildTask(userId: string, skillId?: string): Promise<BuildTask> {
    await this.ensureBuildSeed();
    const cooldownStart = new Date(Date.now() - 14 * 86_400_000);
    const recent = await this.prisma.attempt.findMany({
      where: { userId, kind: 'build', createdAt: { gte: cooldownStart } },
      select: { questionId: true },
    });
    const excludeIds = recent.map((r) => r.questionId).filter((id): id is string => !!id);
    const where: { kind: string; flagged: boolean; id?: { notIn: string[] }; skillIds?: { has: string } } = {
      kind: 'build',
      flagged: false,
    };
    if (excludeIds.length > 0) where.id = { notIn: excludeIds };
    if (skillId) where.skillIds = { has: skillId };
    let eligible = await this.prisma.question.findMany({ where });
    if (skillId && eligible.length < MIN_ELIGIBLE_POOL) {
      if (eligible.length === 0) {
        const gen = await this.generateBuildTask(userId, skillId).catch(() => null);
        if (gen) {
          const row = await this.prisma.question.findUnique({ where: { id: gen.id } });
          if (row) eligible = [row];
        }
      } else {
        void this.generateBuildTask(userId, skillId).catch(() => null);
      }
    }
    const pool =
      eligible.length > 0
        ? eligible
        : await this.prisma.question.findMany({ where: { kind: 'build', flagged: false } });
    if (pool.length === 0) throw new NotFoundException('No build tasks available');
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const meta = safeJson<{
      language?: LanguageId;
      title?: string;
      starter?: string;
      timeoutMs?: number;
    }>(pick.answerHint ?? '{}') ?? {};
    return {
      id: pick.id,
      title: meta.title ?? 'Build task',
      description: pick.prompt,
      language: meta.language ?? 'node',
      starter: meta.starter ?? '',
      timeoutMs: meta.timeoutMs ?? 10_000,
      skillIds: pick.skillIds,
      difficulty: pick.difficulty,
    };
  }

  async generateBuildTask(
    userId: string,
    skillId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  ): Promise<BuildTask | null> {
    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) return null;
    try {
      await this.usage.assertCallAllowed(userId);
      const cfg = await this.prisma.providerConfig.findFirst({
        where: { userId, isDefault: true },
      });
      if (!cfg) return null;
      await this.sensitivity.assertAllowed(cfg.provider, 'public', userId);

      const secret = await this.prisma.encryptedSecret.findUnique({
        where: { id: cfg.apiKeySecretId },
      });
      if (!secret) return null;
      const apiKey = decrypt(secret.ciphertext, KEY, `provider:${cfg.provider}:apiKey`);

      if (cfg.provider !== 'deepseek') return null;
      const provider = new DeepSeekProvider({
        apiKey,
        baseUrl: cfg.baseUrl ?? undefined,
        chatModel: cfg.chatModel,
        onCall: makeLlmAuditor(this.prisma, userId, this.logger as never, this.usageCache),
      });

      const rendered = renderBuildTaskPrompt({
        skillId: skill.id,
        skillName: skill.name,
        difficulty,
      });
      const result = (await this.usage.runWithUserLimit(userId, () =>
        provider.chatStructured({
          messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user },
          ],
          schema: rendered.schema,
          temperature: 0.7,
        }),
      )) as GeneratedBuildTask;

      const promptHash = hashPrompt(`${result.title}::${result.description}`);
      const row = await this.prisma.question.upsert({
        where: { promptHash },
        create: {
          kind: 'build',
          skillIds: [skillId],
          difficulty: result.difficulty,
          prompt: result.description,
          keyPoints: [result.tests],
          answerHint: JSON.stringify({
            language: result.language,
            title: result.title,
            starter: result.starter,
            timeoutMs: result.timeoutMs,
          }),
          promptHash,
        },
        update: {},
      });
      return {
        id: row.id,
        title: result.title,
        description: result.description,
        language: result.language,
        starter: result.starter,
        timeoutMs: result.timeoutMs,
        skillIds: row.skillIds,
        difficulty: row.difficulty,
      };
    } catch (err) {
      this.logger.warn(`build-task-generator failed for skill=${skillId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Grade a build-task submission by executing it in the Docker-per-run sandbox.
   * The sandbox call is the real wire from C-P2.4 (replaces the previous TODO).
   * Contract: tests print `PASS <name>` / `FAIL <name>` lines; score =
   * passed / (passed + failed). Zero recognised lines → score 0 with a
   * self-reported reason, never a thrown error. Sandbox paused / timeout /
   * crash all map to score 0 with the status surfaced in reasoning + gradingJson
   * so the runner UI can tell the user why.
   */
  async gradeBuildAttempt(
    userId: string,
    input: { questionId: string; code: string; durationMs?: number },
  ): Promise<AttemptResult> {
    if (typeof input.code !== 'string' || input.code.trim().length === 0) {
      throw new BadRequestException('code is required');
    }
    const q = await this.prisma.question.findUnique({ where: { id: input.questionId } });
    if (!q || q.kind !== 'build') {
      throw new NotFoundException('Task not found');
    }
    const meta = safeJson<{
      language?: LanguageId;
      title?: string;
      starter?: string;
      timeoutMs?: number;
    }>(q.answerHint ?? '{}') ?? {};
    const language = meta.language ?? 'node';
    const starter = meta.starter ?? '';
    const tests = q.keyPoints[0] ?? '';
    const timeoutMs = Math.min(Math.max(meta.timeoutMs ?? 10_000, 1_000), 30_000);
    if (!tests) {
      throw new BadRequestException('Task is malformed: missing tests');
    }

    // starter + candidate + tests concatenated as one file. The generator contract
    // promises tests reference the symbols the candidate exports in `starter`.
    const program = `${starter}\n${input.code}\n${tests}\n`;
    const sandboxResult = await this.runSandbox({ language, code: program, timeoutMs });
    const grading = scoreBuildRun(sandboxResult);

    const attempt = await this.prisma.attempt.create({
      data: {
        userId,
        questionId: q.id,
        kind: 'build',
        score: grading.score.toFixed(3),
        reasoning: grading.reasoning,
        answerJson: { code: input.code },
        gradingJson: {
          passed: grading.passed,
          failed: grading.failed,
          total: grading.total,
          sandbox: {
            status: sandboxResult.status,
            exitCode: sandboxResult.exitCode,
            wallTimeMs: sandboxResult.wallTimeMs,
            ...(sandboxResult.killedBy ? { killedBy: sandboxResult.killedBy } : {}),
          },
          grader: 'sandbox' as const,
        },
        ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
      },
    });

    const signal = grading.score >= 0.7 ? 'correct-independent' : 'incorrect-with-correction';
    const skillDeltas: AttemptResult['skillDeltas'] = [];
    for (const skillId of q.skillIds) {
      const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
      if (!skill) continue;
      const beforeState = await this.prisma.candidateSkillState.findUnique({
        where: { userId_skillId: { userId, skillId } },
      });
      await this.prisma.evidence.create({
        data: {
          userId,
          skillId,
          kind: 'assessment',
          signal,
          weightHint: grading.score.toFixed(3),
          sourceRef: { kind: 'attempt', id: attempt.id },
          detail: {
            questionId: q.id,
            passed: grading.passed,
            failed: grading.failed,
            total: grading.total,
            sandboxStatus: sandboxResult.status,
          },
        },
      });
      const after = await syncSkillState(this.prisma, userId, skillId);
      skillDeltas.push({
        skillId,
        beforeLevel: beforeState?.level ?? 1,
        afterLevel: after.level,
        beforeProficiency: beforeState ? Number(beforeState.proficiency) : 0,
        afterProficiency: after.state.proficiency,
      });
      await this.reconcileRemediation(userId, skillId, skill.name, grading.score);
    }

    const xpAwarded = xpFor('build', grading.score);
    await this.prisma.xpEvent.create({
      data: { userId, attemptId: attempt.id, reason: 'attempt:build', xp: xpAwarded },
    });

    const [xpSum, streakState] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.tickStreak(userId, new Date()),
    ]);
    const totalXp = xpSum._sum.xp ?? 0;

    const hits = grading.passedNames.map((n) => `pass: ${n}`);
    const misses = grading.failedNames.map((n) => `fail: ${n}`);
    return {
      attemptId: attempt.id,
      score: grading.score,
      hits,
      misses,
      reasoning: grading.reasoning,
      xpAwarded,
      totalXp,
      ...levelChange(totalXp, xpAwarded),
      streakDays: streakState.currentDays,
      skillDeltas,
    };
  }

  /** Hand-seeded build-task so `nextBuildTask` works before any LLM provider is wired. */
  private async ensureBuildSeed(): Promise<void> {
    for (const seed of BUILD_SEED) {
      const promptHash = hashPrompt(`${seed.title}::${seed.description}`);
      await this.prisma.question.upsert({
        where: { promptHash },
        create: {
          kind: 'build',
          skillIds: seed.skillIds,
          difficulty: seed.difficulty,
          prompt: seed.description,
          keyPoints: [seed.tests],
          answerHint: JSON.stringify({
            language: seed.language,
            title: seed.title,
            starter: seed.starter,
            timeoutMs: seed.timeoutMs,
          }),
          promptHash,
        },
        update: {},
      });
    }
  }

  /**
   * Return the next boss-battle milestone the user is eligible for, plus any
   * active boss (so the runner can resume). "Eligible" = user's current level
   * has reached the milestone AND no passed boss row exists for it.
   */
  async getEligibleBossMilestone(userId: string): Promise<EligibleBossMilestone> {
    const xpSum = await this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } });
    const totalXp = xpSum._sum.xp ?? 0;
    const currentLevel = xpLevel(totalXp).level;

    const active = await this.prisma.bossBattle.findFirst({
      where: { userId, status: 'active' },
      orderBy: { startedAt: 'desc' },
    });
    // Auto-expire an active boss whose timer has run out — server-authoritative.
    if (active && this.bossExpired(active.startedAt, active.durationS)) {
      await this.prisma.bossBattle.update({
        where: { id: active.id },
        data: { status: 'expired' },
      });
    }
    const stillActive = active && !this.bossExpired(active.startedAt, active.durationS) ? active : null;

    const passed = await this.prisma.bossBattle.findMany({
      where: { userId, status: 'passed' },
      select: { milestone: true },
    });
    const passedSet = new Set(passed.map((p) => p.milestone));
    const nextMilestone = BOSS_MILESTONES.find((m) => currentLevel >= m && !passedSet.has(m)) ?? null;

    return {
      milestone: nextMilestone,
      currentLevel,
      activeBossId: stillActive?.id ?? null,
    };
  }

  /**
   * Start a boss battle for a milestone. Picks 3 knowledge questions drawn
   * from a *related* set of touched skills (3+ user-touched skills sharing an
   * ESCO category — frontend, backend, cloud, ...), so the encounter rewards
   * combining neighbouring skills rather than regurgitating one. Generates
   * fresh if the eligible pool is thin. Rejects if an active boss already
   * exists, the milestone is already passed, or the user has not touched 3+
   * related skills yet.
   */
  async startBossBattle(userId: string, milestone: number): Promise<BossBattleTask> {
    if (!BOSS_MILESTONES.includes(milestone as (typeof BOSS_MILESTONES)[number])) {
      throw new BadRequestException(`milestone must be one of ${BOSS_MILESTONES.join(', ')}`);
    }
    const eligible = await this.getEligibleBossMilestone(userId);
    if (eligible.currentLevel < milestone) {
      throw new BadRequestException(`Need level ${milestone}, currently at ${eligible.currentLevel}`);
    }
    if (eligible.activeBossId) {
      throw new BadRequestException(`A boss battle is already active (${eligible.activeBossId})`);
    }
    const alreadyPassed = await this.prisma.bossBattle.findFirst({
      where: { userId, milestone, status: 'passed' },
      select: { id: true },
    });
    if (alreadyPassed) throw new BadRequestException(`Milestone ${milestone} already cleared`);

    // 3+ related-skills threshold: resolve the user's touched skills to their
    // ESCO categories (populated by apps/api/src/seed/esco.ts) and require at
    // least one category with 3 or more touched skills before the fight is
    // even allowed to start. "Related" = share a category. This blocks the
    // degenerate case where a user with only `react` + a stale evidence row
    // on `postgres` triggers a milestone that cannot be a true combo check.
    // ponytail: using `category` directly; swap to a persisted
    // `skill_graph_core` adjacency table when ESCO relations ingest lands.
    const relatedSet = await this.getLargestRelatedTouchedSet(userId);
    if (relatedSet.skillIds.length < 3) {
      throw new BadRequestException(
        'Boss battle needs 3+ related skills touched. Earn evidence on more skills in a shared area (frontend, backend, cloud, ...) first.',
      );
    }

    const questions = await this.pickBossQuestions(userId, relatedSet.skillIds);
    if (questions.length < 3) {
      throw new BadRequestException(
        'Not enough questions available for your related-skill cluster. Complete a few knowledge attempts across those skills first so the bank fills up.',
      );
    }

    // Partial-unique on (userId) WHERE status='active' guards against races —
    // swallow P2002 as "already active" for a helpful message.
    try {
      const row = await this.prisma.bossBattle.create({
        data: {
          userId,
          milestone,
          questionIds: questions.map((q) => q.id),
        },
      });
      return this.serializeBoss(row.id, row.startedAt, row.durationS, row.status as BossBattleTask['status'], milestone, questions);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('A boss battle is already active');
      }
      throw err;
    }
  }

  async getBossBattle(userId: string, id: string): Promise<BossBattleTask> {
    const row = await this.prisma.bossBattle.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Boss battle not found');
    if (row.status === 'active' && this.bossExpired(row.startedAt, row.durationS)) {
      await this.prisma.bossBattle.update({ where: { id: row.id }, data: { status: 'expired' } });
      row.status = 'expired';
    }
    const questions = await this.prisma.question.findMany({ where: { id: { in: row.questionIds } } });
    const orderedQs = row.questionIds
      .map((qid) => questions.find((q) => q.id === qid))
      .filter((q): q is (typeof questions)[number] => !!q)
      .map((q) => ({ id: q.id, prompt: q.prompt, skillIds: q.skillIds, difficulty: q.difficulty }));
    return this.serializeBoss(row.id, row.startedAt, row.durationS, row.status as BossBattleTask['status'], row.milestone, orderedQs);
  }

  /**
   * Submit boss-battle answers. Server-authoritative timer check happens FIRST
   * so a client-side clock skew can't cheat the deadline. Grades all 3 via the
   * LLM grader (per-Q), sums scores, writes evidence per skill on each Q,
   * awards boss-battle XP if score >= 0.7.
   */
  async submitBossBattle(
    userId: string,
    id: string,
    answers: string[],
  ): Promise<
    AttemptResult & {
      bossStatus: 'passed' | 'failed' | 'expired';
      comboDetected: boolean;
      comboMultiplier: number;
      comboCategory: string | null;
      relatedSkillsDemonstrated: string[];
    }
  > {
    const row = await this.prisma.bossBattle.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Boss battle not found');
    if (row.status !== 'active') {
      throw new BadRequestException(`Boss battle already ${row.status}`);
    }
    if (this.bossExpired(row.startedAt, row.durationS)) {
      await this.prisma.bossBattle.update({ where: { id }, data: { status: 'expired' } });
      throw new BadRequestException('Boss battle timer expired');
    }
    if (!Array.isArray(answers) || answers.length !== row.questionIds.length) {
      throw new BadRequestException(`Expected ${row.questionIds.length} answers`);
    }

    const questions = await this.prisma.question.findMany({ where: { id: { in: row.questionIds } } });
    const attemptIds: string[] = [];
    const perQuestionScores: number[] = [];
    const allSkills = new Set<string>();

    for (let i = 0; i < row.questionIds.length; i++) {
      const qid = row.questionIds[i]!;
      const q = questions.find((x) => x.id === qid);
      if (!q) continue;
      for (const s of q.skillIds) allSkills.add(s);

      const grading = await this.gradeWithLlmOrFallback(userId, answers[i] ?? '', q.prompt, q.keyPoints);
      const attempt = await this.prisma.attempt.create({
        data: {
          userId,
          questionId: q.id,
          kind: 'knowledge',
          score: grading.score.toFixed(3),
          reasoning: grading.reasoning,
          answerJson: { answer: answers[i], bossBattleId: id },
          gradingJson: { hits: grading.hits, misses: grading.misses, grader: grading.grader, boss: true },
        },
      });
      attemptIds.push(attempt.id);
      perQuestionScores.push(grading.score);

      // Evidence per skill on each Q — normal knowledge-attempt flow.
      for (const skillId of q.skillIds) {
        const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
        if (!skill) continue;
        await this.prisma.evidence.create({
          data: {
            userId,
            skillId,
            kind: 'assessment',
            signal: grading.score >= 0.7 ? 'correct-independent' : 'incorrect-with-correction',
            weightHint: grading.score.toFixed(3),
            sourceRef: { kind: 'attempt', id: attempt.id, bossBattleId: id },
            detail: { questionId: q.id, hits: grading.hits, misses: grading.misses, boss: true },
          },
        });
        await syncSkillState(this.prisma, userId, skillId);
      }
    }

    const overall = perQuestionScores.reduce((a, s) => a + s, 0) / Math.max(1, perQuestionScores.length);
    const bossStatus: 'passed' | 'failed' = overall >= 0.7 ? 'passed' : 'failed';

    // Multi-skill combo: deterministic parse off the per-question scores +
    // skill tags. Rewards the user for actually using 2+ *related* skills
    // (shared ESCO category) within the same encounter. The bonus is only
    // meaningful on a passing boss — on a failed boss the bonus still appears
    // in the reasoning line so the user sees what combo would have earned.
    const combo = await this.detectBossCombo(row.questionIds, perQuestionScores);

    await this.prisma.bossBattle.update({
      where: { id },
      data: {
        status: bossStatus,
        submittedAt: new Date(),
        score: overall.toFixed(3),
        attemptIds,
      },
    });

    const xpBase = xpFor('boss-battle', overall);
    const xpAwarded =
      bossStatus === 'passed' ? Math.round(xpBase * combo.comboMultiplier) : xpBase;
    await this.prisma.xpEvent.create({
      data: {
        userId,
        reason:
          combo.combo && bossStatus === 'passed'
            ? `attempt:boss-battle:L${row.milestone}:combo`
            : `attempt:boss-battle:L${row.milestone}`,
        xp: xpAwarded,
      },
    });

    const [xpSum, streakState] = await Promise.all([
      this.prisma.xpEvent.aggregate({ where: { userId }, _sum: { xp: true } }),
      this.tickStreak(userId, new Date()),
    ]);
    const totalXp = xpSum._sum.xp ?? 0;

    const hits = perQuestionScores
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s >= 0.7)
      .map(({ s, i }) => `Q${i + 1}: ${(s * 100).toFixed(0)}%`);
    const misses = perQuestionScores
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s < 0.7)
      .map(({ s, i }) => `Q${i + 1}: ${(s * 100).toFixed(0)}%`);

    const comboLine =
      combo.combo && bossStatus === 'passed'
        ? ` Combo detected: ${combo.relatedSkillsDemonstrated.length} ${combo.comboCategory ?? 'related'} skills, ${Math.round((combo.comboMultiplier - 1) * 100)}% XP bonus.`
        : combo.combo
          ? ` Combo detected but boss failed (bonus applies only to passes).`
          : '';
    return {
      attemptId: id,
      score: overall,
      hits,
      misses,
      reasoning: `Boss battle L${row.milestone}: ${bossStatus.toUpperCase()} (${(overall * 100).toFixed(0)}%). ${hits.length}/${perQuestionScores.length} questions passed.${comboLine}`,
      xpAwarded,
      totalXp,
      ...levelChange(totalXp, xpAwarded),
      streakDays: streakState.currentDays,
      skillDeltas: [],
      bossStatus,
      comboDetected: combo.combo,
      comboMultiplier: combo.comboMultiplier,
      comboCategory: combo.comboCategory,
      relatedSkillsDemonstrated: combo.relatedSkillsDemonstrated,
    };
  }

  private bossExpired(startedAt: Date, durationS: number): boolean {
    return Date.now() - startedAt.getTime() > durationS * 1000;
  }

  /**
   * Pick 3 knowledge questions, restricted to the supplied related-skill set
   * when the caller provides one (boss-battle). Without a restriction, falls
   * back to any touched skill (not used by boss-battle today, kept for future
   * reuse). Variety: avoid repeating the same single skill across picks when
   * the related pool has 3+ skills to pick from.
   */
  private async pickBossQuestions(
    userId: string,
    restrictToSkills?: string[],
  ): Promise<Array<{ id: string; prompt: string; skillIds: string[]; difficulty: string }>> {
    await this.ensureSeed();
    let eligibleSkills: string[];
    if (restrictToSkills && restrictToSkills.length > 0) {
      eligibleSkills = restrictToSkills;
    } else {
      const touched = await this.prisma.evidence.findMany({
        where: { userId },
        select: { skillId: true },
        distinct: ['skillId'],
      });
      eligibleSkills = touched.map((t) => t.skillId).filter((s): s is string => !!s);
    }

    const pool = await this.prisma.question.findMany({
      where: {
        kind: 'knowledge',
        flagged: false,
        ...(eligibleSkills.length > 0 ? { skillIds: { hasSome: eligibleSkills } } : {}),
      },
      take: 30,
    });
    if (pool.length < 3) return [];

    // Simple variety: shuffle, then pick 3 avoiding same-skill duplicates when possible.
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const picked: typeof pool = [];
    const usedSkills = new Set<string>();
    for (const q of shuffled) {
      if (picked.length === 3) break;
      const overlap = q.skillIds.some((s) => usedSkills.has(s));
      if (overlap && eligibleSkills.length >= 3) continue;
      picked.push(q);
      for (const s of q.skillIds) usedSkills.add(s);
    }
    // Backfill if variety constraint left us short.
    for (const q of shuffled) {
      if (picked.length === 3) break;
      if (picked.some((p) => p.id === q.id)) continue;
      picked.push(q);
    }
    return picked.slice(0, 3).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      skillIds: q.skillIds,
      difficulty: q.difficulty,
    }));
  }

  /**
   * Resolve the user's touched skills (any evidence) to their ESCO category
   * and return the largest category group with 3 or more touched skills.
   * Returns an empty skillIds array when no cluster meets the threshold —
   * callers must treat that as "boss-battle not eligible yet".
   *
   * ponytail: in-process group-by over a small set (touched skills + ~200
   * skill rows). Push into SQL when either side grows past a few thousand.
   */
  private async getLargestRelatedTouchedSet(
    userId: string,
  ): Promise<{ category: string | null; skillIds: string[] }> {
    const touched = await this.prisma.evidence.findMany({
      where: { userId },
      select: { skillId: true },
      distinct: ['skillId'],
    });
    const touchedIds = touched.map((t) => t.skillId).filter((s): s is string => !!s);
    if (touchedIds.length < 3) return { category: null, skillIds: [] };

    const skillRows = await this.prisma.skill.findMany({
      where: { id: { in: touchedIds } },
      select: { id: true, category: true },
    });
    const byCategory = new Map<string, string[]>();
    for (const s of skillRows) {
      // Skills with no category (seed drift, legacy rows) do not count as
      // "related" to anything — a null bucket would create a false group.
      if (!s.category) continue;
      const bucket = byCategory.get(s.category) ?? [];
      bucket.push(s.id);
      byCategory.set(s.category, bucket);
    }
    let best: { category: string; skillIds: string[] } | null = null;
    for (const [cat, ids] of byCategory) {
      if (ids.length < 3) continue;
      if (!best || ids.length > best.skillIds.length) best = { category: cat, skillIds: ids };
    }
    return best ?? { category: null, skillIds: [] };
  }

  /**
   * Multi-skill combo detection. Given per-question outcomes + the question
   * rows, resolve each question's skills to their ESCO category, pick the
   * category that spans the most *passed* questions, and count how many
   * distinct skills in that category the user actually demonstrated (passed
   * question tagged with that skill). Combo = 2+ distinct related skills
   * passed. Returns the related skill IDs so the grading payload can cite
   * them + the multiplier the caller should apply to XP.
   *
   * ponytail: deterministic parse off `question.skillIds` + `skill.category`,
   * no LLM round trip. Upgrade path when build-task / debugging boss variants
   * land: feed the LLM grader the related-skill list and ask it to score
   * cross-skill usage; keep this as the floor.
   */
  private async detectBossCombo(
    questionIds: string[],
    perQuestionScores: number[],
  ): Promise<{
    comboCategory: string | null;
    relatedSkillsDemonstrated: string[];
    combo: boolean;
    comboMultiplier: number;
  }> {
    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, skillIds: true },
    });
    const allSkillIds = Array.from(new Set(questions.flatMap((q) => q.skillIds)));
    if (allSkillIds.length === 0) {
      return { comboCategory: null, relatedSkillsDemonstrated: [], combo: false, comboMultiplier: 1 };
    }
    const skillRows = await this.prisma.skill.findMany({
      where: { id: { in: allSkillIds } },
      select: { id: true, category: true },
    });
    const categoryOf = new Map(skillRows.map((s) => [s.id, s.category ?? null] as const));

    // Map category -> set of distinct skillIds the user *passed on*.
    const passedByCategory = new Map<string, Set<string>>();
    for (let i = 0; i < questionIds.length; i++) {
      const qid = questionIds[i]!;
      const score = perQuestionScores[i] ?? 0;
      if (score < 0.7) continue;
      const q = questions.find((x) => x.id === qid);
      if (!q) continue;
      for (const sid of q.skillIds) {
        const cat = categoryOf.get(sid);
        if (!cat) continue;
        const bucket = passedByCategory.get(cat) ?? new Set<string>();
        bucket.add(sid);
        passedByCategory.set(cat, bucket);
      }
    }
    let best: { category: string; skills: Set<string> } | null = null;
    for (const [cat, skills] of passedByCategory) {
      if (!best || skills.size > best.skills.size) best = { category: cat, skills };
    }
    const demonstrated = best?.skills ?? new Set<string>();
    const combo = demonstrated.size >= 2;
    // 1.25x multiplier is deliberately modest: enough to be visible, small
    // enough that a lucky mono-skill pass isn't dwarfed. ponytail: fixed
    // constant; move to shared/knowledge-rules.ts if a second caller rewards combos.
    return {
      comboCategory: best?.category ?? null,
      relatedSkillsDemonstrated: Array.from(demonstrated),
      combo,
      comboMultiplier: combo ? 1.25 : 1,
    };
  }

  private serializeBoss(
    id: string,
    startedAt: Date,
    durationS: number,
    status: BossBattleTask['status'],
    milestone: number,
    questions: BossBattleTask['questions'],
  ): BossBattleTask {
    return {
      id,
      milestone,
      startedAt: startedAt.toISOString(),
      durationS,
      expiresAt: new Date(startedAt.getTime() + durationS * 1000).toISOString(),
      status,
      questions,
    };
  }

  private async gradeMockInterviewWithLlmOrFallback(
    userId: string,
    answers: string[],
    scenario: string,
    questions: MockInterviewQuestion[],
  ): Promise<MockInterviewGrade & { grader: 'llm' | 'rule' }> {
    const wrappedAnswers = wrapUntrusted(
      answers.map((a, i) => `${i + 1}. ${a}`).join('\n\n'),
      'user-input',
    );
    const renderedQuestions = questions
      .map((q, i) => `${i + 1}. [${q.kind}] ${q.prompt}\n   Key points: ${q.keyPoints.join(', ')}`)
      .join('\n\n');
    return this.runLlmGraderOrFallback<MockInterviewGrade>(userId, {
      promptId: 'mock-interview-grader',
      vars: { scenario, questions: renderedQuestions, answers: wrappedAnswers.content },
      sensitivity: 'personal',
      fallback: () => gradeMockInterview(answers, questions),
    });
  }

  /**
   * LLM grader with rule-based fallback. Same pattern as knowledge — bail to
   * `gradeCodeReview` (token overlap) on no-provider / paused / gate-blocked /
   * non-deepseek / provider failure.
   */
  private async gradeReviewWithLlmOrFallback(
    userId: string,
    findings: string[],
    diff: string,
    defects: string[],
  ): Promise<CodeReviewGrade & { grader: 'llm' | 'rule' }> {
    const wrappedFindings = wrapUntrusted(findings.map((f, i) => `${i + 1}. ${f}`).join('\n'), 'user-input');
    return this.runLlmGraderOrFallback<CodeReviewGrade>(userId, {
      promptId: 'code-review-grader',
      vars: {
        diff,
        defects: defects.map((d) => `- ${d}`).join('\n'),
        findings: wrappedFindings.content,
      },
      sensitivity: 'personal',
      fallback: () => gradeCodeReview(findings, defects),
    });
  }

  /**
   * Open a remediation task when the user has 3+ consecutive fails on this
   * skill in the last 14 days; auto-close any open task on a passing attempt.
   * Partial-unique index (`WHERE status='open'`) prevents stacking.
   */
  private async reconcileRemediation(
    userId: string,
    skillId: string,
    skillName: string,
    thisScore: number,
  ): Promise<void> {
    if (thisScore >= 0.7) {
      // Auto-close any open remediation on a solid pass.
      await this.prisma.remediationTask.updateMany({
        where: { userId, skillId, status: 'open' },
        data: { status: 'closed', closedAt: new Date() },
      });
      return;
    }

    const recent = await this.prisma.attempt.findMany({
      where: {
        userId,
        question: { skillIds: { has: skillId } },
        createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, score: true, createdAt: true },
    });

    const decision = shouldRemediate(
      recent.map((r) => ({ score: Number(r.score), createdAt: r.createdAt })),
    );
    if (!decision.shouldOpen) return;

    // Upsert-by-partial-index isn't natively supported in Prisma; a plain
    // create relies on the partial-unique index to short-circuit dupes.
    // Swallow the P2002 collision so a concurrent grade doesn't 500.
    try {
      await this.prisma.remediationTask.create({
        data: {
          userId,
          skillId,
          reason: `${decision.reason} on ${skillName}`,
          sourceAttemptIds: decision.triggeringAttempts.slice(0, 5).map((_, i) => recent[i]?.id ?? ''),
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'P2002') throw err;
    }
  }

  async listRemediation(userId: string) {
    const rows = await this.prisma.remediationTask.findMany({
      where: { userId, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      skillId: r.skillId,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      sourceAttemptIds: r.sourceAttemptIds,
    }));
  }

  async completeRemediation(userId: string, id: string): Promise<void> {
    const result = await this.prisma.remediationTask.updateMany({
      where: { id, userId, status: 'open' },
      data: { status: 'closed', closedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Remediation task not found or already closed');
  }

  /**
   * Try the LLM grader; fall back to the deterministic rule-based grader if the
   * user has no provider configured, LLM calls are paused/over-budget, the
   * sensitivity gate blocks the provider, or the provider call fails. `grader`
   * on the return tells callers which path produced the score.
   */
  private async gradeWithLlmOrFallback(
    userId: string,
    answer: string,
    question: string,
    keyPoints: string[],
  ): Promise<KnowledgeGrade & { grader: 'llm' | 'rule' }> {
    const wrapped = wrapUntrusted(answer, 'user-input');
    return this.runLlmGraderOrFallback<KnowledgeGrade>(userId, {
      promptId: 'knowledge-grader',
      vars: {
        question,
        keyPoints: keyPoints.map((k) => `- ${k}`).join('\n'),
        answer: wrapped.content,
      },
      sensitivity: 'personal',
      fallback: () => gradeKnowledge(answer, keyPoints),
    });
  }

  private async tickStreak(userId: string, at: Date) {
    const row = await this.prisma.streak.findUnique({ where: { userId } });
    const current = row
      ? {
          currentDays: row.currentDays,
          longestDays: row.longestDays,
          lastAttemptDate: row.lastAttemptDate,
          graceRemaining: row.graceRemaining,
          graceResetsAt: row.graceResetsAt,
        }
      : newStreak(at);
    const next = streakTick(current, at);
    await this.prisma.streak.upsert({
      where: { userId },
      create: {
        userId,
        currentDays: next.currentDays,
        longestDays: next.longestDays,
        lastAttemptDate: next.lastAttemptDate,
        graceRemaining: next.graceRemaining,
        graceResetsAt: next.graceResetsAt,
      },
      update: {
        currentDays: next.currentDays,
        longestDays: next.longestDays,
        lastAttemptDate: next.lastAttemptDate,
        graceRemaining: next.graceRemaining,
        graceResetsAt: next.graceResetsAt,
      },
    });
    return next;
  }
}

/** Pack the current level info + level-up detection into what the runner UI needs. */
function levelChange(totalXp: number, xpAwarded: number) {
  const info = xpLevel(totalXp);
  const previousLevel = xpLevel(Math.max(0, totalXp - xpAwarded)).level;
  return { level: info, previousLevel, leveledUp: previousLevel < info.level };
}

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 32);
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Parse PASS/FAIL lines out of a sandbox run and compute score = passed/total.
 * Line regex matches `PASS <name>` / `FAIL <name>` anywhere on a line; the test
 * harness contract (see build-task-generator prompt) requires one such line per
 * test case. Sandbox non-ok statuses (timeout, oom, crash, paused) short-circuit
 * to score 0 and surface the status in `reasoning` for the runner UI.
 */
export function scoreBuildRun(result: SandboxResult): {
  score: number;
  passed: number;
  failed: number;
  total: number;
  passedNames: string[];
  failedNames: string[];
  reasoning: string;
} {
  if (result.status !== 'ok') {
    const stderrTail = result.stderr.slice(-400);
    return {
      score: 0,
      passed: 0,
      failed: 0,
      total: 0,
      passedNames: [],
      failedNames: [],
      reasoning:
        `Sandbox ${result.status}${result.killedBy ? ` (${result.killedBy})` : ''}` +
        (stderrTail ? `: ${stderrTail}` : '.'),
    };
  }
  const passedNames: string[] = [];
  const failedNames: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const pass = line.match(/^\s*PASS\s+(.+?)\s*$/);
    if (pass && pass[1]) {
      passedNames.push(pass[1]);
      continue;
    }
    const fail = line.match(/^\s*FAIL\s+(.+?)\s*$/);
    if (fail && fail[1]) failedNames.push(fail[1]);
  }
  const total = passedNames.length + failedNames.length;
  if (total === 0) {
    return {
      score: 0,
      passed: 0,
      failed: 0,
      total: 0,
      passedNames: [],
      failedNames: [],
      reasoning: 'No PASS/FAIL lines emitted by test harness. Did the implementation compile?',
    };
  }
  const score = passedNames.length / total;
  return {
    score,
    passed: passedNames.length,
    failed: failedNames.length,
    total,
    passedNames,
    failedNames,
    reasoning:
      score === 1
        ? `All ${total} tests passed.`
        : `${passedNames.length}/${total} tests passed. Failing: ${failedNames.join(', ')}.`,
  };
}

// ponytail: 5 hand-seeded questions covering the common P1 skills. Replaced by
// the question-generator agent + eval-gated bank in slice 2.
const KNOWLEDGE_SEED: Array<{
  skillIds: string[];
  difficulty: string;
  prompt: string;
  keyPoints: string[];
  answerHint: string | null;
}> = [
  {
    skillIds: ['react'],
    difficulty: 'easy',
    prompt:
      'Explain how React decides which DOM nodes to update between two renders. Mention at least the diffing strategy and any data structure it relies on.',
    keyPoints: ['virtual DOM', 'reconciler', 'keys'],
    answerHint: 'Think about the tree-diff and how lists are identified.',
  },
  {
    skillIds: ['typescript'],
    difficulty: 'easy',
    prompt:
      'What does the `unknown` type give you that `any` does not? Give a concrete example of narrowing an `unknown` before use.',
    keyPoints: ['type-safe', 'narrowing', 'typeof'],
    answerHint: '`unknown` forces a check before assignment.',
  },
  {
    skillIds: ['node-js'],
    difficulty: 'medium',
    prompt:
      'A Node.js HTTP handler spends 40ms parsing a large JSON body and 8ms hitting Postgres. Which of the two is more likely to block other requests under load and why?',
    keyPoints: ['single-threaded', 'event loop', 'JSON.parse'],
    answerHint: 'One is CPU-bound in the main thread; the other is async I/O.',
  },
  {
    skillIds: ['postgres'],
    difficulty: 'medium',
    prompt:
      'Describe when a partial index outperforms a plain B-tree index. Give one query shape that would benefit.',
    keyPoints: ['partial index', 'WHERE', 'selective'],
    answerHint: 'Skewed distributions where most rows are irrelevant.',
  },
  {
    skillIds: ['docker'],
    difficulty: 'easy',
    prompt:
      'Why prefer a distroless base image over ubuntu for a production Node service? Name at least two concrete benefits.',
    keyPoints: ['smaller', 'attack surface', 'no shell'],
    answerHint: 'Think image size and CVE exposure.',
  },
];

// ponytail: 2 hand-seeded build tasks per language so the consumer wire ships
// without blocking on a build-task eval set. Replaced by `build-task-generator`
// once operators have provider credentials wired. Test harness contract: each
// test case prints exactly one of `PASS <name>` or `FAIL <name>` to stdout.
const BUILD_SEED: Array<{
  skillIds: string[];
  difficulty: string;
  language: LanguageId;
  title: string;
  description: string;
  starter: string;
  tests: string;
  timeoutMs: number;
}> = [
  {
    skillIds: ['node-js'],
    difficulty: 'easy',
    language: 'node',
    title: 'Implement sum(a, b)',
    description:
      'Export a function `sum(a, b)` that returns the arithmetic sum of two numbers. Submit the full function; the harness will exercise it with three cases.',
    starter: '// Edit below. Keep the name `sum` so the test harness can find it.\nfunction sum(a, b) {\n  // your code\n}\n',
    tests: [
      "const assert = (cond, name) => console.log((cond ? 'PASS ' : 'FAIL ') + name);",
      "assert(sum(1, 2) === 3, 'adds positives');",
      "assert(sum(-1, 1) === 0, 'adds mixed signs');",
      "assert(sum(0, 0) === 0, 'adds zero');",
    ].join('\n'),
    timeoutMs: 10_000,
  },
  {
    skillIds: ['python'],
    difficulty: 'easy',
    language: 'python',
    title: 'Implement reverse_words(s)',
    description:
      "Define `reverse_words(s)` that returns the input string with the order of whitespace-separated words reversed. Single spaces between words; `reverse_words('a b c') == 'c b a'`.",
    starter: "def reverse_words(s):\n    # your code\n    return s\n",
    tests: [
      'def _assert(cond, name): print(("PASS " if cond else "FAIL ") + name)',
      "_assert(reverse_words('a b c') == 'c b a', 'three words')",
      "_assert(reverse_words('hello') == 'hello', 'single word')",
      "_assert(reverse_words('') == '', 'empty string')",
    ].join('\n'),
    timeoutMs: 10_000,
  },
];
