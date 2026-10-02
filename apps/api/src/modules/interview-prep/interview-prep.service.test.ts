import { describe, expect, it, vi } from 'vitest';
import type { InterviewPrepPlan, TalkTrack } from '@careeros/ai';
import '@careeros/ai'; // ensure prompt registry loads
import type { PrismaService } from '../../prisma/prisma.service';
import type { UsageService } from '../usage/usage.service';
import type { UsageCache } from '../usage/usage.cache';
import type { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { InterviewPrepService } from './interview-prep.service';

/**
 * F.4 unit tests. Fakes prisma + provider + usage. Focus:
 *   - generateTalkTrack REJECTS a draft citing an unknown factId
 *     (this is the ai-safety Item 6 fact-check guard for F.4)
 *   - Happy path stores the talk-track keyed by topicId
 *   - Missing plan -> NotFound
 */

const APP = {
  id: 'app-1',
  userId: 'u-1',
  jobId: 'job-1',
  resumeVariantId: 'rv-1',
};

const JOB = {
  id: 'job-1',
  title: 'Senior Backend Engineer',
  company: 'Stripe',
  description: 'Build backend systems. Requires distributed systems, Go, and payment expertise.',
};

const EVIDENCE = [
  { id: 'e1', userId: 'u-1', kind: 'employment', detail: { summary: 'Led payments migration' }, sourceRef: null, createdAt: new Date() },
  { id: 'e2', userId: 'u-1', kind: 'employment', detail: { summary: 'Scaled search cluster to 500 QPS' }, sourceRef: null, createdAt: new Date() },
];

const PLAN: InterviewPrepPlan = {
  topics: [
    {
      id: 'payments',
      title: 'Payments migration story',
      source: 'job_description',
      rationale: 'Job mentions payment expertise',
      evidenceFactIds: ['e1'],
      suggestedDurationSec: 90,
    },
    {
      id: 'scaling',
      title: 'Scaling search',
      source: 'resume_bullet',
      rationale: 'Job requires distributed systems experience',
      evidenceFactIds: ['e2'],
      suggestedDurationSec: 120,
    },
    {
      id: 'no-evidence',
      title: 'Rust ownership',
      source: 'inferred',
      rationale: 'Deep systems trivia',
      evidenceFactIds: [],
      suggestedDurationSec: 60,
    },
  ],
};

function fakePrisma(seed: {
  prep?: { plan: InterviewPrepPlan; talkTracks: Record<string, unknown> } | null;
  providerConfig?: { provider: string; chatModel: string; apiKeySecretId: string; baseUrl: string | null } | null;
  secret?: { ciphertext: Buffer } | null;
} = {}): PrismaService {
  return {
    application: {
      findFirst: async () => APP,
      findUnique: async () => APP,
    },
    normalizedJob: { findUnique: async () => JOB },
    resumeVariant: { findUnique: async () => null },
    companyDossier: { findUnique: async () => null },
    evidence: {
      findMany: async (args: { where: { id?: { in: string[] } } }) => {
        if (args.where.id?.in) {
          return EVIDENCE.filter((e) => args.where.id!.in.includes(e.id));
        }
        return EVIDENCE;
      },
    },
    interviewPrep: {
      findUnique: async () =>
        seed.prep === null
          ? null
          : seed.prep
            ? { id: 'ip-1', userId: 'u-1', applicationId: 'app-1', plan: seed.prep.plan, talkTracks: seed.prep.talkTracks, createdAt: new Date(), updatedAt: new Date() }
            : null,
      upsert: async () => ({ id: 'ip-1', talkTracks: {} }),
      update: async () => ({ id: 'ip-1' }),
    },
    providerConfig: { findFirst: async () => seed.providerConfig ?? null },
    encryptedSecret: { findUnique: async () => seed.secret ?? null },
  } as unknown as PrismaService;
}

function fakeUsage(): UsageService {
  return {
    assertCallAllowed: async () => {},
    runWithUserLimit: async <T,>(_userId: string, fn: () => Promise<T>) => fn(),
  } as unknown as UsageService;
}

function fakeUsageCache(): UsageCache {
  return {} as unknown as UsageCache;
}

function fakeSensitivity(): SensitivityGateService {
  return { assertAllowed: async () => {} } as unknown as SensitivityGateService;
}

describe('InterviewPrepService.generateTalkTrack', () => {
  it('throws NotFound when no plan exists', async () => {
    const svc = new InterviewPrepService(
      fakePrisma({ prep: null }),
      fakeUsage(),
      fakeUsageCache(),
      fakeSensitivity(),
    );
    await expect(svc.generateTalkTrack('u-1', 'app-1', 'payments')).rejects.toThrow(/plan/);
  });

  it('throws NotFound when topic not in plan', async () => {
    const svc = new InterviewPrepService(
      fakePrisma({ prep: { plan: PLAN, talkTracks: {} } }),
      fakeUsage(),
      fakeUsageCache(),
      fakeSensitivity(),
    );
    await expect(svc.generateTalkTrack('u-1', 'app-1', 'nonexistent')).rejects.toThrow(/nonexistent/);
  });

  it('refuses topics with zero evidence backing (fail-safe)', async () => {
    const svc = new InterviewPrepService(
      fakePrisma({
        prep: { plan: PLAN, talkTracks: {} },
        providerConfig: {
          provider: 'deepseek',
          chatModel: 'v3',
          apiKeySecretId: 'sec-1',
          baseUrl: null,
        },
        secret: { ciphertext: Buffer.from('x') },
      }),
      fakeUsage(),
      fakeUsageCache(),
      fakeSensitivity(),
    );
    // no-evidence topic has evidenceFactIds=[]; loadEvidenceByIds returns
    // [] -> service returns ok:false with a helpful reason. This short-
    // circuits before touching the provider so we do not even need to
    // stub chatStructured.
    const result = await svc.generateTalkTrack('u-1', 'app-1', 'no-evidence');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no evidence/);
    // MUTATION-SMOKE: remove the evidence-length guard and this fires
    // an unnecessary LLM call instead of failing fast.
  });

  it('rejects a talk-track that cites an unknown factId', async () => {
    // Provider returns a "correct-looking" draft but with a bogus factRef.
    // Service MUST refuse before storing. This guards the ai-safety
    // Item 6 fact-check requirement in the F.4 spec.
    const bogusTrack: TalkTrack = {
      draft: 'I recently rewrote our payments migration, saved 2ms per call.',
      factRefs: ['bogus-id'],
    };
    const chatStructured = vi.fn().mockResolvedValue(bogusTrack);
    // Stub DeepSeekProvider constructor via the service by making
    // loadProvider return a hand-built provider-like object. Since
    // loadProvider is private, we instead replace the prisma so the
    // real DeepSeekProvider ctor sees an encrypted key it can decrypt -
    // but decrypting requires the master-key wire-up. Simpler: intercept
    // the chatStructured on DeepSeekProvider's prototype.
    const { DeepSeekProvider } = await import('@careeros/ai');
    const spy = vi.spyOn(DeepSeekProvider.prototype, 'chatStructured').mockImplementation(chatStructured);
    try {
      // Provider config + secret must round-trip through the real decrypt
      // helper. Use the actual encrypt helper to produce a valid ciphertext.
      const { encrypt, loadMasterKey } = await import('@careeros/secrets');
      const ct = encrypt('fake-api-key', loadMasterKey(), 'provider:deepseek:apiKey');
      const svc = new InterviewPrepService(
        fakePrisma({
          prep: { plan: PLAN, talkTracks: {} },
          providerConfig: {
            provider: 'deepseek',
            chatModel: 'deepseek-chat',
            apiKeySecretId: 'sec-1',
            baseUrl: null,
          },
          secret: { ciphertext: Buffer.from(ct, 'base64') },
        }),
        fakeUsage(),
        fakeUsageCache(),
        fakeSensitivity(),
      );
      const result = await svc.generateTalkTrack('u-1', 'app-1', 'payments');
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/bogus-id/);
      expect(chatStructured).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
