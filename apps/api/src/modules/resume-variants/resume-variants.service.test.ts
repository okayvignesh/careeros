import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { FactCheckResult, TailoredResumeContent } from '@careeros/shared';
import { ResumeVariantsService } from './resume-variants.service';

// The service does two LLM calls per generation: (1) the writer producing a
// TailoredResumeContent, (2) the fact-check auditor producing a FactCheckResult.
// The fake provider queues responses in order and pops one per chatStructured
// call so each test scripts exactly what the LLM "returns" for both passes.
type QueuedResponse = TailoredResumeContent | FactCheckResult | Error;

function makeFakeProvider(responses: QueuedResponse[]): {
  provider: { chatStructured: (args: unknown) => Promise<unknown> };
  callCount: () => number;
} {
  let i = 0;
  const provider = {
    chatStructured: async (_args: unknown): Promise<unknown> => {
      const r = responses[i++];
      if (r === undefined) throw new Error(`fake provider: no queued response for call ${i}`);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { provider, callCount: () => i };
}

// Minimal Prisma fake. Records the persisted variant so a test can assert what
// went to disk after the fact-check gate ran (and confirm dropped bullets never
// got written). getById round-trips via the stored `contentJson` wrapper.
type FactRow = { id: string; kind: string; content: Record<string, unknown>; verified: boolean };
function fakePrisma(opts: {
  facts?: FactRow[];
  job?: { id: string; title: string; company: string; description: string } | null;
  profile?: Record<string, unknown> | null;
}) {
  const facts = opts.facts ?? [];
  const job =
    opts.job === undefined
      ? { id: 'job-1', title: 'SRE', company: 'Acme', description: 'Do SRE things.' }
      : opts.job;
  let created:
    | { id: string; userId: string; jobId: string; roleTarget: string; templateId: string; contentJson: unknown; factRefs: string[]; createdAt: Date }
    | null = null;

  return {
    getCreated: () => created,
    normalizedJob: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        job && job.id === where.id ? job : null,
    },
    userJobPreferences: {
      findUnique: async () => opts.profile ?? null,
    },
    resumeFact: {
      findMany: async ({ where }: { where: { userId: string; verified?: boolean; id?: { in: string[] } } }) => {
        if (where.id?.in) {
          return facts.filter((f) => where.id!.in.includes(f.id));
        }
        return facts.filter((f) => f.verified);
      },
    },
    candidateSkillState: {
      findMany: async () => [] as Array<{ skillId: string }>,
    },
    providerConfig: {
      findFirst: async () => ({
        userId: 'u1',
        provider: 'deepseek',
        isDefault: true,
        chatModel: 'deepseek-chat',
        baseUrl: null,
        apiKeySecretId: 'sec-1',
      }),
    },
    encryptedSecret: {
      findUnique: async () => ({ id: 'sec-1', ciphertext: Buffer.from('x') }),
    },
    resumeVariant: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = {
          id: 'variant-1',
          userId: data.userId as string,
          jobId: data.jobId as string,
          roleTarget: data.roleTarget as string,
          templateId: (data.templateId as string) ?? 'ats-first',
          contentJson: data.contentJson,
          factRefs: data.factRefs as string[],
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
        return created;
      },
      findFirst: async () => created,
    },
  };
}

const fakeUsage = {
  assertCallAllowed: async () => undefined,
  runWithUserLimit: async <T>(_u: string, fn: () => Promise<T>) => fn(),
};
const fakeUsageCache = { remember: async () => undefined, bumpVersion: async () => undefined };
const fakeSensitivity = { assertAllowed: async () => undefined };

// Build a service instance and override the private tryLoadProvider so the test
// controls provider.chatStructured directly (no MSW, no real DeepSeek client,
// no assertPublicUrl DNS trip). Prototype patch is scoped to the instance.
function buildService(
  prisma: ReturnType<typeof fakePrisma>,
  provider: { chatStructured: (a: unknown) => Promise<unknown> },
): ResumeVariantsService {
  const svc = new ResumeVariantsService(
    prisma as never,
    fakeUsage as never,
    fakeUsageCache as never,
    fakeSensitivity as never,
    { loadProviderForUser: async () => null } as never,
  );
  (svc as unknown as { tryLoadProvider: (u: string) => Promise<unknown> }).tryLoadProvider = async () => provider;
  return svc;
}

// Two facts, both verified. Everything downstream cites these IDs.
const FACT_A: FactRow = {
  id: 'fact-a',
  kind: 'employment',
  content: { title: 'SRE Lead', company: 'Acme', start: '2022', end: '2025', bullets: ['ran postgres'] },
  verified: true,
};
const FACT_B: FactRow = {
  id: 'fact-b',
  kind: 'employment',
  content: { title: 'SWE', company: 'Beta', start: '2020', end: '2022' },
  verified: true,
};

function writerOutput(sections: Array<{ heading: string; bullets: Array<{ text: string; factRefs: string[] }> }>): TailoredResumeContent {
  return { summary: 'Ten years running production systems at scale.', sections };
}

describe('ResumeVariantsService.generateForJob fact-check gate (B-3)', () => {
  it('all bullets pass fact-check → all kept, audit=passed, factRefs present on every bullet', async () => {
    const writer = writerOutput([
      {
        heading: 'Experience',
        bullets: [
          { text: 'Ran a highly available Postgres fleet.', factRefs: ['fact-a'] },
          { text: 'Shipped Beta backend in Go.', factRefs: ['fact-b'] },
        ],
      },
    ]);
    const audit: FactCheckResult = {
      results: [
        { bulletIndex: 0, supported: true, reason: 'matches fact-a bullets' },
        { bulletIndex: 1, supported: true, reason: 'matches fact-b role' },
      ],
    };
    const prisma = fakePrisma({ facts: [FACT_A, FACT_B] });
    const { provider, callCount } = makeFakeProvider([writer, audit]);
    const svc = buildService(prisma, provider);

    const dto = await svc.generateForJob('u1', 'job-1');

    expect(callCount()).toBe(2);
    expect(dto.audit.status).toBe('passed');
    expect(dto.audit.bulletsChecked).toBe(2);
    expect(dto.audit.bulletsPassed).toBe(2);
    expect(dto.audit.bulletsDropped).toBe(0);
    expect(dto.audit.dropped).toEqual([]);
    const kept = dto.content.sections.flatMap((s) => s.bullets);
    expect(kept).toHaveLength(2);
    // Grounded-generation contract: every kept bullet exposes a non-empty factRefs array.
    for (const b of kept) {
      expect(Array.isArray(b.factRefs)).toBe(true);
      expect(b.factRefs.length).toBeGreaterThan(0);
    }
    // MUTATION-SMOKE: flip `if (v.supported) { passed++; return true; }` to
    // `return false` and this test's expect(kept).toHaveLength(2) drops to 0
    // (and the throw at line 202 fires instead).
  });

  it('bullet marked unsupported by the LLM produces a DroppedBullet entry with the LLM reason', async () => {
    const writer = writerOutput([
      {
        heading: 'Experience',
        bullets: [
          { text: 'Led the Postgres migration.', factRefs: ['fact-a'] },
          { text: 'Invented Kubernetes.', factRefs: ['fact-a'] },
        ],
      },
    ]);
    const audit: FactCheckResult = {
      results: [
        { bulletIndex: 0, supported: true, reason: 'ok' },
        { bulletIndex: 1, supported: false, reason: 'not supported by cited facts' },
      ],
    };
    const prisma = fakePrisma({ facts: [FACT_A, FACT_B] });
    const { provider } = makeFakeProvider([writer, audit]);
    const svc = buildService(prisma, provider);

    const dto = await svc.generateForJob('u1', 'job-1');

    expect(dto.audit.status).toBe('partial');
    expect(dto.audit.bulletsChecked).toBe(2);
    expect(dto.audit.bulletsPassed).toBe(1);
    expect(dto.audit.bulletsDropped).toBe(1);
    expect(dto.audit.dropped).toEqual([
      { section: 'Experience', text: 'Invented Kubernetes.', reason: 'not supported by cited facts' },
    ]);
    expect(dto.content.sections[0].bullets).toHaveLength(1);
    expect(dto.content.sections[0].bullets[0].text).toBe('Led the Postgres migration.');
    // MUTATION-SMOKE: change the unsupported branch from `return false` to
    // `return true` and dropped.length falls to 0 while kept goes to 2.
  });

  it('"no verdict returned" branch: malformed/empty verdict drops the bullet AND logs the drop reason', async () => {
    const writer = writerOutput([
      {
        heading: 'Experience',
        bullets: [
          { text: 'Ran the migration.', factRefs: ['fact-a'] },
          { text: 'Cut latency in half.', factRefs: ['fact-a'] },
        ],
      },
    ]);
    // Auditor only scored bullet 0. Bullet 1 has no verdict → must drop.
    const audit: FactCheckResult = {
      results: [{ bulletIndex: 0, supported: true, reason: 'ok' }],
    };
    const prisma = fakePrisma({ facts: [FACT_A] });
    const { provider } = makeFakeProvider([writer, audit]);
    const svc = buildService(prisma, provider);

    const dto = await svc.generateForJob('u1', 'job-1');

    expect(dto.audit.bulletsDropped).toBe(1);
    const drop = dto.audit.dropped.find((d) => d.text === 'Cut latency in half.');
    expect(drop).toBeDefined();
    // The drop reason is recorded in the audit trail (equivalent of "logging the drop reason":
    // persisted in FactCheckAudit.dropped, surfaced to the UI and to observability).
    expect(drop!.reason).toBe('no verdict returned by fact-check');
    expect(dto.content.sections[0].bullets.map((b) => b.text)).toEqual(['Ran the migration.']);
    // MUTATION-SMOKE: change `if (!v)` early-return to `return true` (keep bullet
    // when auditor is silent): bulletsDropped falls to 0, dropped[] empty.
  });

  it('missing-verdict-drop-default: when the auditor returns zero verdicts, every bullet is dropped by the "no verdict" default', async () => {
    const writer = writerOutput([
      {
        heading: 'Experience',
        bullets: [
          { text: 'Ran the migration.', factRefs: ['fact-a'] },
          { text: 'Cut latency in half.', factRefs: ['fact-a'] },
        ],
      },
    ]);
    // Empty verdict list: auditor gave no opinions at all.
    const audit: FactCheckResult = { results: [] };
    const prisma = fakePrisma({ facts: [FACT_A] });
    const { provider } = makeFakeProvider([writer, audit]);
    const svc = buildService(prisma, provider);

    // Every bullet drops → runFactCheck returns [] → generateForJob throws.
    // Trust-default: unspecified = drop, not keep. If the drop-default were
    // "keep", the variant would persist with un-audited bullets instead.
    // Single call; queue only has one writer + one audit response.
    let caught: unknown;
    try {
      await svc.generateForJob('u1', 'job-1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as Error).message).toMatch(/Fact-check dropped every bullet/);
    // MUTATION-SMOKE: swap the trust-default from drop to keep and the
    // BadRequestException never fires (variant persists with un-audited bullets).
  });

  it('hallucination guard: bullets whose factRefs are not in the master fact base are stripped BEFORE the fact-check even runs', async () => {
    // Writer cites a bogus fact ID plus a legit one. The bogus-only bullet
    // must be dropped by the hallucination guard (pre-fact-check). Legit
    // bullet continues to the fact-check as normal.
    const writer = writerOutput([
      {
        heading: 'Experience',
        bullets: [
          { text: 'Wrote a bestselling novel.', factRefs: ['fact-hallucinated'] },
          { text: 'Led the Postgres migration.', factRefs: ['fact-a', 'fact-hallucinated'] },
        ],
      },
    ]);
    const audit: FactCheckResult = {
      // NOTE: only ONE bullet reaches the auditor because hallucination guard
      // dropped the first. The surviving bullet's flat index therefore is 0.
      results: [{ bulletIndex: 0, supported: true, reason: 'ok' }],
    };
    const prisma = fakePrisma({ facts: [FACT_A] });
    const { provider } = makeFakeProvider([writer, audit]);
    const svc = buildService(prisma, provider);

    const dto = await svc.generateForJob('u1', 'job-1');

    const kept = dto.content.sections.flatMap((s) => s.bullets);
    expect(kept).toHaveLength(1);
    expect(kept[0].text).toBe('Led the Postgres migration.');
    // Fabricated ref pruned; only known fact IDs survive on the kept bullet.
    expect(kept[0].factRefs).toEqual(['fact-a']);
    // MUTATION-SMOKE: remove `factRefs.filter((id) => knownIds.has(id))` so
    // fabricated IDs pass through → kept.length becomes 2 and factRefs still
    // contains 'fact-hallucinated'.
  });

  it('throws BadRequestException when every writer bullet is hallucinated (no bullets survive the hallucination guard)', async () => {
    // All refs point at IDs the user does not own → cleanedSections is empty
    // → the pre-fact-check guard throws BEFORE any fact-check call is made.
    const writer = writerOutput([
      {
        heading: 'Experience',
        bullets: [
          { text: 'Wrote a bestselling novel.', factRefs: ['ghost-1'] },
          { text: 'Won the Nobel prize.', factRefs: ['ghost-2'] },
        ],
      },
    ]);
    const prisma = fakePrisma({ facts: [FACT_A] });
    const { provider, callCount } = makeFakeProvider([writer]);
    const svc = buildService(prisma, provider);

    let caught: unknown;
    try {
      await svc.generateForJob('u1', 'job-1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as Error).message).toMatch(/no bullets grounded in your verified facts/);
    // Fact-check pass never fired: writer is the only LLM call.
    expect(callCount()).toBe(1);
    // MUTATION-SMOKE: remove the `if (cleanedSections.length === 0) throw` and
    // this test now reaches the fact-check pass and either succeeds vacuously
    // or fails on the fake provider's no-queued-response error.
  });

  it('grounded-generation contract: persisted contentJson wraps {content, audit}; every kept bullet has a factRefs array; row.factRefs is the deduped union', async () => {
    const writer = writerOutput([
      {
        heading: 'Experience',
        bullets: [
          { text: 'Bullet one.', factRefs: ['fact-a'] },
          { text: 'Bullet two.', factRefs: ['fact-a', 'fact-b'] },
        ],
      },
    ]);
    const audit: FactCheckResult = {
      results: [
        { bulletIndex: 0, supported: true, reason: 'ok' },
        { bulletIndex: 1, supported: true, reason: 'ok' },
      ],
    };
    const prisma = fakePrisma({ facts: [FACT_A, FACT_B] });
    const { provider } = makeFakeProvider([writer, audit]);
    const svc = buildService(prisma, provider);

    await svc.generateForJob('u1', 'job-1');
    const row = prisma.getCreated();
    expect(row).not.toBeNull();
    // Persisted wrapper shape (slice-20 contract, read back by unwrapContentJson).
    const stored = row!.contentJson as { content: TailoredResumeContent; audit: unknown };
    expect(stored.content).toBeDefined();
    expect(stored.audit).toBeDefined();
    // factRefs union is deduped across all kept bullets.
    expect(new Set(row!.factRefs)).toEqual(new Set(['fact-a', 'fact-b']));
    expect(row!.factRefs.length).toBe(2);
    // Every kept bullet still carries its factRefs array (grounded-generation contract).
    for (const sec of stored.content.sections) {
      for (const b of sec.bullets) {
        expect(Array.isArray(b.factRefs)).toBe(true);
        expect(b.factRefs.length).toBeGreaterThan(0);
      }
    }
    // MUTATION-SMOKE: drop the `Array.from(new Set(...))` dedupe and `factRefs`
    // becomes [fact-a, fact-a, fact-b] → length 3 → this test's length===2 fails.
  });

  it('fact-check LLM failure marks audit=unchecked but keeps every bullet (draft-with-warning over no-draft)', async () => {
    const writer = writerOutput([
      {
        heading: 'Experience',
        bullets: [
          { text: 'Bullet one.', factRefs: ['fact-a'] },
          { text: 'Bullet two.', factRefs: ['fact-a'] },
        ],
      },
    ]);
    // Second LLM call (the fact-check) throws → caught, marked unchecked.
    const prisma = fakePrisma({ facts: [FACT_A] });
    const { provider } = makeFakeProvider([writer, new Error('deepseek 500')]);
    const loggerWarn = vi.fn();
    const svc = buildService(prisma, provider);
    // Swap the private logger to observe the warn call (documents the "log" side
    // of the "no verdict / auditor failed" behaviour named in the spec).
    (svc as unknown as { logger: { warn: (s: string) => void } }).logger = {
      warn: loggerWarn,
    };

    const dto = await svc.generateForJob('u1', 'job-1');

    expect(dto.audit.status).toBe('unchecked');
    expect(dto.audit.bulletsChecked).toBe(0);
    expect(dto.audit.bulletsPassed).toBe(2);
    expect(dto.audit.bulletsDropped).toBe(0);
    expect(dto.content.sections[0].bullets).toHaveLength(2);
    expect(loggerWarn).toHaveBeenCalledOnce();
    expect(loggerWarn.mock.calls[0][0]).toMatch(/fact-check pass failed/);
    // MUTATION-SMOKE: change the catch branch to rethrow instead of marking
    // unchecked, and generateForJob rejects instead of returning a dto.
  });
});

// P2b: capture the rendered user prompt so targeting variables can be asserted.
function capturingProvider(responses: QueuedResponse[]): {
  provider: { chatStructured: (args: { messages: Array<{ role: string; content: string }> }) => Promise<unknown> };
  users: string[];
} {
  const users: string[] = [];
  let i = 0;
  return {
    users,
    provider: {
      chatStructured: async ({ messages }) => {
        users.push(messages.find((m) => m.role === 'user')?.content ?? '');
        const r = responses[i++];
        if (r === undefined) throw new Error(`fake provider: no queued response for call ${i}`);
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

describe('ResumeVariantsService P2b region-aware tailoring', () => {
  const profile = {
    targetRoles: ['Staff SRE'],
    countries: ['DE'],
    homeCountry: null,
    seniority: ['staff'],
    relocationWilling: false,
    relocationCountries: [],
  };

  it('resolves role/region/template from the profile and persists them', async () => {
    const prisma = fakePrisma({ facts: [FACT_A, FACT_B], profile });
    const writer = writerOutput([
      { heading: 'Experience', bullets: [{ text: 'Ran Postgres.', factRefs: ['fact-a'] }] },
    ]);
    const audit: FactCheckResult = { results: [{ bulletIndex: 0, supported: true, reason: 'ok' }] };
    const { provider } = makeFakeProvider([writer, audit]);
    const svc = buildService(prisma, provider);

    const dto = await svc.generateForJob('u1', 'job-1');

    // Target-role override (no longer forced to `job.title`), region template.
    expect(dto.roleTarget).toBe('Staff SRE');
    expect(dto.region).toBe('europe');
    expect(dto.templateId).toBe('international');
    expect(prisma.getCreated()!.templateId).toBe('international');
    // MUTATION-SMOKE: force roleTarget back to job.title and the first assertion fails.
  });

  it('honors a valid explicit template override', async () => {
    const prisma = fakePrisma({ facts: [FACT_A], profile });
    const writer = writerOutput([
      { heading: 'Experience', bullets: [{ text: 'Ran Postgres.', factRefs: ['fact-a'] }] },
    ]);
    const audit: FactCheckResult = { results: [{ bulletIndex: 0, supported: true, reason: 'ok' }] };
    const { provider } = makeFakeProvider([writer, audit]);
    const svc = buildService(prisma, provider);

    const dto = await svc.generateForJob('u1', 'job-1', { template: 'dense-tech' });
    expect(dto.templateId).toBe('dense-tech');
  });

  it('prompt carries targetRole/region and contact comes only from verified facts', async () => {
    const prisma = fakePrisma({
      facts: [
        FACT_A,
        { id: 'fact-loc', kind: 'location', content: { text: 'Berlin, Germany' }, verified: true },
        { id: 'fact-loc-bad', kind: 'location', content: { text: 'Invented City' }, verified: false },
      ],
      profile: { ...profile, targetRoles: ['Backend Engineer'], seniority: ['mid'] },
    });
    const writer = writerOutput([
      { heading: 'Experience', bullets: [{ text: 'Ran Postgres.', factRefs: ['fact-a'] }] },
    ]);
    const audit: FactCheckResult = { results: [{ bulletIndex: 0, supported: true, reason: 'ok' }] };
    const { provider, users } = capturingProvider([writer, audit]);
    const svc = buildService(prisma, provider as never);

    const dto = await svc.generateForJob('u1', 'job-1');

    expect(users[0]).toContain('Target role (frame the resume for this role): Backend Engineer');
    expect(users[0]).toContain('Target region: europe');
    // Unverified fact text never reaches the prompt.
    expect(users[0]).not.toContain('Invented City');
    // ResumeDoc contact block is sourced from the verified `location` fact only.
    expect(dto.contact).toEqual({ location: 'Berlin, Germany' });
    // MUTATION-SMOKE: drop `verified: true` from the fact query and the
    // unverified location leaks into both the prompt and the contact block.
  });
});
