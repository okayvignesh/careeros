import { describe, expect, it } from 'vitest';
import { makeLlmAuditor } from './llm-audit';
import { MetricsService } from './metrics/metrics.service';

/**
 * C-P4.8: assert the auditor emits Prometheus metrics on every LLM call,
 * without depending on the shape of the DB write (which is exercised
 * elsewhere). Uses a fake prisma so no db is required.
 */
describe('makeLlmAuditor metric emit', () => {
  it('increments call counter + tokens + duration histogram', async () => {
    const created: unknown[] = [];
    const fakePrisma = {
      llmCall: { create: async ({ data }: { data: unknown }) => created.push(data) },
    } as unknown as import('../prisma/prisma.service').PrismaService;

    const metrics = new MetricsService();

    const auditor = makeLlmAuditor(fakePrisma, 'user-1', undefined, undefined, metrics);
    await auditor({
      provider: 'deepseek',
      model: 'deepseek-chat',
      callKind: 'chat',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      latencyMs: 1200,
      ok: true,
    });
    await auditor({
      provider: 'deepseek',
      model: 'deepseek-chat',
      callKind: 'chat',
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      latencyMs: 500,
      ok: false,
      error: 'timeout',
    });

    const text = await metrics.render();

    expect(text).toContain(
      'careeros_llm_calls_total{provider="deepseek",model="deepseek-chat",ok="true"} 1',
    );
    expect(text).toContain(
      'careeros_llm_calls_total{provider="deepseek",model="deepseek-chat",ok="false"} 1',
    );
    expect(text).toContain(
      'careeros_llm_tokens_total{provider="deepseek",model="deepseek-chat",kind="input"} 100',
    );
    expect(text).toContain(
      'careeros_llm_tokens_total{provider="deepseek",model="deepseek-chat",kind="output"} 50',
    );
    expect(text).toContain(
      'careeros_llm_call_duration_seconds_count{provider="deepseek",model="deepseek-chat"} 2',
    );

    // db row still written
    expect(created).toHaveLength(2);
  });

  it('no-ops when metrics is not passed (legacy call sites)', async () => {
    const fakePrisma = {
      llmCall: { create: async () => ({}) },
    } as unknown as import('../prisma/prisma.service').PrismaService;

    const auditor = makeLlmAuditor(fakePrisma, null);
    // Just asserts it doesn't throw when metrics arg is omitted.
    await expect(
      auditor({
        provider: 'p',
        model: 'm',
        callKind: 'chat',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        latencyMs: 10,
        ok: true,
      }),
    ).resolves.toBeUndefined();
  });
});
