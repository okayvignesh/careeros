import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CoverLetterContent, FactCheckResult } from '@careeros/shared';
import { renderPrompt } from '@careeros/ai';
import { CoverLettersService } from './cover-letters.service';

// B-4: grounded-generation contract for cover letters.
//
// Strategy: build a real CoverLettersService with fake prisma/usage/sensitivity,
// then override the private `tryLoadProvider` to hand back a stub with a
// scripted `chatStructured`. The service's whole grounded-generation pipeline
// (facts -> prompt -> LLM -> id filter -> fact-check -> persist) runs against
// live code. Prisma/usage/sensitivity are the trust boundaries; the service
// arithmetic is what we cover.
//
// ponytail: no NestJS DI container here. Direct constructor is 5 lines vs
// 50 lines of `TestingModule.createTestingModule`, and the service takes only
// four collaborators. Upgrade to DI wiring when a controller-level test lands.

type FactRow = { id: string; kind: string; content: unknown; verified: boolean };

interface Persisted {
  data: {
    userId: string;
    jobId: string;
    roleTarget: string;
    contentJson: { content: CoverLetterContent; audit: unknown };
    factRefs: string[];
  };
}

function fakePrisma(opts: {
  job?: { id: string; title: string; company: string; description: string } | null;
  facts?: FactRow[];
  providerConfig?: { provider: string; isDefault: boolean; apiKeySecretId: string; baseUrl: string | null; chatModel: string } | null;
  profile?: Record<string, unknown> | null;
}) {
  const facts = opts.facts ?? [];
  const created: Persisted[] = [];
  return {
    _created: created,
    normalizedJob: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (opts.job && opts.job.id === where.id) return opts.job;
        return null;
      },
    },
    userJobPreferences: {
      findUnique: async () => opts.profile ?? null,
    },
    resumeFact: {
      findMany: async ({ where }: { where: { userId: string; verified?: boolean; id?: { in: string[] } } }) => {
        let rows = facts.filter((f) => (where.verified === undefined ? true : f.verified === where.verified));
        if (where.id?.in) {
          const ids = new Set(where.id.in);
          rows = rows.filter((f) => ids.has(f.id));
        }
        void where.userId;
        return rows;
      },
    },
    providerConfig: {
      findFirst: async () => opts.providerConfig ?? null,
    },
    coverLetter: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
        const row = created.find((c) => c.data.userId === where.userId);
        if (!row) return null;
        // Only one letter per test; caller looks up by whatever id .create returned.
        return {
          id: where.id,
          userId: row.data.userId,
          jobId: row.data.jobId,
          roleTarget: row.data.roleTarget,
          templateId: 'default',
          contentJson: row.data.contentJson,
          factRefs: row.data.factRefs,
          createdAt: new Date('2026-09-27T00:00:00Z'),
        };
      },
      create: async ({ data }: Persisted) => {
        created.push({ data });
        return { id: 'letter-1' };
      },
    },
  };
}

const fakeUsage = {
  runWithUserLimit: async <T,>(_u: string, fn: () => Promise<T>) => fn(),
  assertCallAllowed: async () => {},
} as unknown as ConstructorParameters<typeof CoverLettersService>[1];

const fakeUsageCache = {} as unknown as ConstructorParameters<typeof CoverLettersService>[2];
const fakeSensitivity = { assertAllowed: async () => {} } as unknown as ConstructorParameters<typeof CoverLettersService>[3];

interface ChatStructuredCall {
  system: string;
  user: string;
}

/**
 * Stub provider whose `chatStructured` is scripted: first call returns the
 * cover-letter draft, subsequent calls return fact-check verdicts. Every call
 * is captured so tests can assert prompt structure.
 */
function stubProvider(scripts: unknown[]) {
  const calls: ChatStructuredCall[] = [];
  let i = 0;
  return {
    calls,
    chatStructured: async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
      calls.push({
        system: messages.find((m) => m.role === 'system')?.content ?? '',
        user: messages.find((m) => m.role === 'user')?.content ?? '',
      });
      const out = scripts[i];
      i++;
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

function buildService(prisma: ReturnType<typeof fakePrisma>) {
  // Tests below spy on `tryLoadProvider`; this null-returning stub is the
  // fallback for the paths that assert the "no provider configured" branch.
  const fakeProviderLoader = { loadProviderForUser: async () => null };
  return new CoverLettersService(
    prisma as never,
    fakeUsage,
    fakeUsageCache,
    fakeSensitivity,
    fakeProviderLoader as never,
  );
}

const twoFacts: FactRow[] = [
  { id: 'f-role-1', kind: 'role', verified: true, content: { title: 'Senior SWE', company: 'Acme', start: '2020', end: '2024' } },
  { id: 'f-edu-1', kind: 'education', verified: true, content: { school: 'MIT', degree: 'BSc CS' } },
];

const job = {
  id: 'job-1',
  title: 'Staff Engineer',
  company: 'Globex',
  description: 'Build distributed systems on Kubernetes.',
};

const validConfig = {
  provider: 'deepseek',
  isDefault: true,
  apiKeySecretId: 'sec-1',
  baseUrl: null,
  chatModel: 'deepseek-chat',
};

const draft = (paras: Array<{ text: string; factRefs: string[] }>): CoverLetterContent => ({
  greeting: 'Dear Hiring Team,',
  paragraphs: paras,
  closing: 'Best regards, Applicant.',
});

const allSupported = (n: number): FactCheckResult => ({
  results: Array.from({ length: n }, (_, i) => ({ bulletIndex: i, supported: true, reason: 'supported' })),
});

describe('CoverLettersService.generateForJob - grounded-generation contract', () => {
  it('every persisted paragraph carries at least one factRef into a known fact ID', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([
        { text: 'Ten years shipping distributed systems at Acme.', factRefs: ['f-role-1'] },
        { text: 'BSc in CS from MIT informs the fundamentals.', factRefs: ['f-edu-1'] },
      ]),
      allSupported(2),
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    const out = await svc.generateForJob('u1', 'job-1');
    expect(out.content.paragraphs.length).toBeGreaterThan(0);
    const knownIds = new Set(twoFacts.map((f) => f.id));
    for (const p of out.content.paragraphs) {
      expect(p.factRefs.length).toBeGreaterThan(0);
      for (const ref of p.factRefs) expect(knownIds.has(ref)).toBe(true);
    }
    // MUTATION-SMOKE: delete the `.filter((p) => p.factRefs.length > 0)` line in
    // the service and a paragraph with zero refs would leak through; then
    // rewrite this test with an LLM output that cites only unknown IDs and it
    // fails the length assertion below.
  });

  it('drops a paragraph whose factRefs point only at unknown fact IDs', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([
        { text: 'Grounded paragraph citing a real fact.', factRefs: ['f-role-1'] },
        { text: 'Fabricated: won a Turing award (not in facts).', factRefs: ['f-fabricated'] },
      ]),
      allSupported(1),
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    const out = await svc.generateForJob('u1', 'job-1');
    expect(out.content.paragraphs).toHaveLength(1);
    expect(out.content.paragraphs[0].factRefs).toEqual(['f-role-1']);
    // MUTATION-SMOKE: remove the `knownIds.has` filter and the fabricated
    // paragraph survives -> length becomes 2, this test fails.
  });

  it('throws BadRequestException when every paragraph cites only unknown fact IDs', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([
        { text: 'Made up claim.', factRefs: ['not-a-real-id'] },
        { text: 'Also invented.', factRefs: [] },
      ]),
      // fact-check would never run (throw happens first); script empty.
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    await expect(svc.generateForJob('u1', 'job-1')).rejects.toBeInstanceOf(BadRequestException);
    // MUTATION-SMOKE: change the guard to `cleanedParagraphs.length < 0` and
    // this test fails because the empty result no longer throws.
  });

  it('drops paragraphs the fact-check LLM marks unsupported (B-3 parity)', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([
        { text: 'Paragraph A cites a fact.', factRefs: ['f-role-1'] },
        { text: 'Paragraph B cites a fact.', factRefs: ['f-edu-1'] },
      ]),
      {
        results: [
          { bulletIndex: 0, supported: true, reason: 'ok' },
          { bulletIndex: 1, supported: false, reason: 'text exceeds cited fact scope' },
        ],
      } satisfies FactCheckResult,
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    const out = await svc.generateForJob('u1', 'job-1');
    expect(out.content.paragraphs).toHaveLength(1);
    expect(out.content.paragraphs[0].text).toBe('Paragraph A cites a fact.');
    expect(out.audit.status).toBe('partial');
    expect(out.audit.paragraphsDropped).toBe(1);
    expect(out.audit.dropped[0].reason).toContain('exceeds cited fact scope');
    // MUTATION-SMOKE: flip the `if (v.supported) return true` branch to
    // `return true` unconditionally and both paragraphs survive -> length 2.
  });

  it('drops paragraphs missing a verdict (missing-verdict = DROP, trust-critical default)', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([
        { text: 'Paragraph A.', factRefs: ['f-role-1'] },
        { text: 'Paragraph B (verdict missing).', factRefs: ['f-edu-1'] },
      ]),
      // Fact-check only returns a verdict for index 0.
      { results: [{ bulletIndex: 0, supported: true, reason: 'ok' }] } satisfies FactCheckResult,
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    const out = await svc.generateForJob('u1', 'job-1');
    expect(out.content.paragraphs).toHaveLength(1);
    expect(out.content.paragraphs[0].text).toBe('Paragraph A.');
    expect(out.audit.dropped[0].reason).toMatch(/no verdict/);
    // MUTATION-SMOKE: change `if (!v) { ... return false }` to `return true`
    // (fail-open) and the unverdicted paragraph slips through.
  });

  it('throws when fact-check drops every paragraph', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([
        { text: 'Paragraph A.', factRefs: ['f-role-1'] },
        { text: 'Paragraph B.', factRefs: ['f-edu-1'] },
      ]),
      {
        results: [
          { bulletIndex: 0, supported: false, reason: 'unsupported' },
          { bulletIndex: 1, supported: false, reason: 'unsupported' },
        ],
      } satisfies FactCheckResult,
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    await expect(svc.generateForJob('u1', 'job-1')).rejects.toBeInstanceOf(BadRequestException);
    // MUTATION-SMOKE: drop the `if (finalParagraphs.length === 0) throw` guard
    // and this test fails (no throw, letter persisted empty).
  });

  it('keeps all paragraphs unchecked when the fact-check call itself throws (fail-open with audit trail)', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([
        { text: 'Paragraph A.', factRefs: ['f-role-1'] },
        { text: 'Paragraph B.', factRefs: ['f-edu-1'] },
      ]),
      new Error('LLM fact-check exploded'),
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    const out = await svc.generateForJob('u1', 'job-1');
    expect(out.content.paragraphs).toHaveLength(2);
    expect(out.audit.status).toBe('unchecked');
    expect(out.audit.paragraphsDropped).toBe(0);
    // MUTATION-SMOKE: delete the try/catch around the fact-check call and this
    // test fails because the exception propagates instead of yielding
    // unchecked audit.
  });
});

describe('CoverLettersService.generateForJob - prompt structure (grounded anchoring)', () => {
  it('user prompt contains numbered verified facts (id + kind) so the LLM has an audit anchor', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([{ text: 'Grounded.', factRefs: ['f-role-1'] }, { text: 'Also grounded.', factRefs: ['f-edu-1'] }]),
      allSupported(2),
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    await svc.generateForJob('u1', 'job-1');
    const draftCall = provider.calls[0];
    // The label the prompt template uses to head the fact list.
    expect(draftCall.user).toContain('Candidate verified facts');
    // Each fact appears as `id=<id> kind=<kind> ...` verbatim (see summariseFact).
    expect(draftCall.user).toContain('id=f-role-1 kind=role');
    expect(draftCall.user).toContain('id=f-edu-1 kind=education');
    // MUTATION-SMOKE: change the `facts` variable in the service to `''` (or
    // rename the placeholder) and both `toContain` assertions fail.
  });

  it('system prompt names the grounding contract (every paragraph MUST cite a factRef)', async () => {
    // Rendering is deterministic and does not need the whole DB stack; asserting
    // directly on renderPrompt is faster and keeps this a real contract test on
    // the shipped prompt.
    const rendered = renderPrompt('cover-letter-writer', {
      jobTitle: 't',
      jobCompany: 'c',
      jobDescription: 'd',
      facts: '- id=f-1 kind=role x',
      targetRole: 'Staff Engineer',
      targetMarket: 'United States',
      region: 'north_america',
      tone: 'professional',
    });
    expect(rendered.system).toMatch(/every paragraph must cite at least one factRef/i);
    expect(rendered.system).toMatch(/do not invent/i);
    // MUTATION-SMOKE: soften the prompt to drop "MUST cite" and the first regex
    // fails on the missing keyword.
  });

  it('wraps the untrusted job description in an <untrusted source="job-description"> envelope', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([{ text: 'Grounded.', factRefs: ['f-role-1'] }, { text: 'Grounded.', factRefs: ['f-edu-1'] }]),
      allSupported(2),
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    await svc.generateForJob('u1', 'job-1');
    const draftCall = provider.calls[0];
    expect(draftCall.user).toContain('<untrusted source="job-description"');
    expect(draftCall.user).toContain('</untrusted>');
    // MUTATION-SMOKE: replace `wrapUntrusted(job.description, ...)` with
    // `job.description` and both delimiter assertions fail.
  });

  it('fact-check prompt uses `resume-bullet-fact-check` and cites the same fact IDs', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([{ text: 'A.', factRefs: ['f-role-1'] }, { text: 'B.', factRefs: ['f-edu-1'] }]),
      allSupported(2),
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    await svc.generateForJob('u1', 'job-1');
    expect(provider.calls).toHaveLength(2);
    const factCheckCall = provider.calls[1];
    // The rendered fact-check prompt lists each cited fact with its id under the paragraph.
    expect(factCheckCall.user).toContain('id=f-role-1');
    expect(factCheckCall.user).toContain('id=f-edu-1');
    expect(factCheckCall.user).toContain('cites:');
    // MUTATION-SMOKE: swap the fact-check prompt id to a nonexistent one and
    // renderPrompt throws before the call is made; test fails on `toHaveLength(2)`.
  });
});

describe('CoverLettersService.generateForJob - precondition guards', () => {
  it('throws NotFoundException on missing job', async () => {
    const prisma = fakePrisma({ job: null, facts: twoFacts, providerConfig: validConfig });
    const svc = buildService(prisma);
    await expect(svc.generateForJob('u1', 'no-such-job')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when the user has zero verified facts', async () => {
    const prisma = fakePrisma({ job, facts: [], providerConfig: validConfig });
    const svc = buildService(prisma);
    await expect(svc.generateForJob('u1', 'job-1')).rejects.toBeInstanceOf(BadRequestException);
    // MUTATION-SMOKE: change `facts.length === 0` to `facts.length < 0` and
    // the empty case falls through to the LLM call, which then fails on
    // "provider not configured" or invalid prompt, but not with the
    // "No verified resume facts" contract.
  });

  it('throws BadRequestException when no provider is available (paused / unconfigured)', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: null });
    const svc = buildService(prisma);
    await expect(svc.generateForJob('u1', 'job-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only feeds verified facts to the prompt (unverified facts never reach the LLM)', async () => {
    const mixed: FactRow[] = [
      ...twoFacts,
      { id: 'f-unverified', kind: 'role', verified: false, content: { title: 'Rockstar', company: 'Nowhere' } },
    ];
    const prisma = fakePrisma({ job, facts: mixed, providerConfig: validConfig });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([{ text: 'A.', factRefs: ['f-role-1'] }, { text: 'B.', factRefs: ['f-edu-1'] }]),
      allSupported(2),
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    await svc.generateForJob('u1', 'job-1');
    const draftCall = provider.calls[0];
    expect(draftCall.user).not.toContain('f-unverified');
    expect(draftCall.user).not.toContain('Rockstar');
    // MUTATION-SMOKE: drop `verified: true` from the resumeFact.findMany where
    // clause in the service and the unverified fact reaches the prompt,
    // failing the `.not.toContain` assertions.
  });
});

describe('CoverLettersService P2b targeting + tone', () => {
  const profile = {
    targetRoles: ['Staff SRE'],
    countries: ['DE'],
    homeCountry: null,
    seniority: ['staff'],
    relocationWilling: false,
    relocationCountries: [],
  };

  it('selects a code-only tone, persists region/tone/role, and renders them into the prompt', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig, profile });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([{ text: 'A.', factRefs: ['f-role-1'] }, { text: 'B.', factRefs: ['f-edu-1'] }]),
      allSupported(2),
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    const out = await svc.generateForJob('u1', 'job-1');

    // staff → concise, picked in code (never by the model).
    expect(out.tone).toBe('concise');
    expect(out.region).toBe('europe');
    expect(out.roleTarget).toBe('Staff SRE');
    expect(provider.calls[0].user).toContain('Tone: concise');
    expect(provider.calls[0].user).toContain('Target region: europe');
    expect(provider.calls[0].user).toContain(
      'Target role (frame the letter for this role): Staff SRE',
    );
    // MUTATION-SMOKE: hardcode tone to a constant and the `toBe('concise')` fails.
  });

  it('honors an explicit valid tone override', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig, profile });
    const svc = buildService(prisma);
    const provider = stubProvider([
      draft([{ text: 'A.', factRefs: ['f-role-1'] }, { text: 'B.', factRefs: ['f-edu-1'] }]),
      allSupported(2),
    ]);
    vi.spyOn(svc as never as { tryLoadProvider: () => Promise<unknown> }, 'tryLoadProvider').mockResolvedValue(provider);

    const out = await svc.generateForJob('u1', 'job-1', { tone: 'warm' });
    expect(out.tone).toBe('warm');
    expect(provider.calls[0].user).toContain('Tone: warm');
  });

  it('rejects an unknown explicit tone before any LLM call', async () => {
    const prisma = fakePrisma({ job, facts: twoFacts, providerConfig: validConfig, profile });
    const svc = buildService(prisma);
    await expect(svc.generateForJob('u1', 'job-1', { tone: 'angry' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
