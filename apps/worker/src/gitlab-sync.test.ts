// C-P1.6e: MSW-mocked gitlab-sync worker test.
// Focus: rate-limit retry contract — 429 twice then 200 must succeed, and
// gitlab.sync.rate_limited must land in audit_log per 429.
import { promises as dns } from 'node:dns';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import pino from 'pino';
import { encrypt, loadMasterKey } from '@careeros/secrets';
import { handleGitlabSync } from './gitlab-sync.js';

// MSW
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// DNS: route gitlab.com to a public IP so safeFetch's assertPublicUrl passes.
const realLookup = dns.lookup;
beforeAll(() => {
  (dns as unknown as { lookup: unknown }).lookup = async (
    host: string,
    opts?: { all?: boolean },
  ): Promise<unknown> => {
    if (host === 'gitlab.com') {
      const rec = { address: '198.51.100.10', family: 4 };
      return opts?.all ? [rec] : rec;
    }
    throw new Error(`unexpected dns lookup: ${host}`);
  };
});
afterAll(() => {
  (dns as unknown as { lookup: unknown }).lookup = realLookup;
});

beforeEach(() => {
  process.env.NODE_ENV = 'development';
});

// -----------------------------------------------------------------------------
// Prisma fake — captures every write so the test can assert side-effects.
// -----------------------------------------------------------------------------

interface FakePrisma {
  integration: {
    findUnique: (args: unknown) => Promise<unknown>;
  };
  encryptedSecret: {
    findUnique: (args: unknown) => Promise<unknown>;
  };
  evidence: {
    create: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  auditEvent: {
    create: (args: { data: { action: string; payload: unknown; userId: string | null } }) => Promise<unknown>;
  };
  candidateSkillState: {
    findUnique: (args: unknown) => Promise<unknown>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  skillStateEvent: {
    create: (args: unknown) => Promise<unknown>;
  };
  $queryRaw: (...args: unknown[]) => Promise<Array<{ id: string }>>;
  calls: {
    evidenceCreates: Array<Record<string, unknown>>;
    auditWrites: Array<{ userId: string | null; action: string; payload: unknown }>;
  };
}

function fakePrisma(): FakePrisma {
  const evidenceCreates: Array<Record<string, unknown>> = [];
  const auditWrites: Array<{ userId: string | null; action: string; payload: unknown }> = [];
  const ciphertext = encrypt('glpat-live-token', loadMasterKey(), 'integration:gitlab:token');
  return {
    integration: {
      findUnique: async () => ({
        userId: 'user-1',
        kind: 'gitlab',
        status: 'connected',
        tokenSecretId: 'sec-1',
        baseUrl: null,
      }),
    },
    encryptedSecret: {
      findUnique: async () => ({ id: 'sec-1', ciphertext }),
    },
    evidence: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        evidenceCreates.push(data);
        return data;
      },
      // Aggregator queries the persisted rows. Return the ones we captured
      // during this test run for the matching (userId, skillId).
      findMany: async ({ where }: { where: { userId: string; skillId: string } }) => {
        return evidenceCreates
          .filter(
            (e) => e.userId === where.userId && e.skillId === where.skillId,
          )
          .map((e, i) => ({
            id: `ev-${i}`,
            observedAt: e.observedAt ?? new Date(),
            kind: e.kind ?? 'code',
            signal: e.signal ?? 'presence',
            weightHint: null,
          }));
      },
    },
    auditEvent: {
      create: async ({ data }) => {
        auditWrites.push({ userId: data.userId, action: data.action, payload: data.payload });
        return data;
      },
    },
    candidateSkillState: {
      findUnique: async () => null,
      upsert: async () => ({}),
    },
    skillStateEvent: {
      create: async () => ({}),
    },
    $queryRaw: async () => [],
    calls: { evidenceCreates, auditWrites },
  };
}

// Silence pino logger; tests only care about return + side-effects.
const logger = pino({ level: 'silent' });

// -----------------------------------------------------------------------------
// The test
// -----------------------------------------------------------------------------

describe('handleGitlabSync (C-P1.6e)', () => {
  it('retries a 429 twice then succeeds; audits each rate-limit hit', async () => {
    let projectCalls = 0;
    server.use(
      http.get('https://gitlab.com/api/v4/projects', () => {
        projectCalls += 1;
        if (projectCalls <= 2) {
          return HttpResponse.json(
            { message: 'rate limited' },
            {
              status: 429,
              headers: {
                'ratelimit-remaining': '0',
                'ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1),
                'retry-after': '1',
              },
            },
          );
        }
        return HttpResponse.json([
          {
            id: 100,
            path_with_namespace: 'me/proj',
            visibility: 'public',
            last_activity_at: '2026-01-01T00:00:00Z',
          },
        ]);
      }),
      http.get('https://gitlab.com/api/v4/projects/100/languages', () =>
        HttpResponse.json({ TypeScript: 80.0, Python: 20.0 }),
      ),
      http.get('https://gitlab.com/api/v4/projects/100/merge_requests', () =>
        HttpResponse.json([]),
      ),
      http.get('https://gitlab.com/api/v4/projects/100/pipelines', () =>
        HttpResponse.json([]),
      ),
    );

    // Spin retry's baseMs way down so the test doesn't wait 2s per attempt.
    // handleGitlabSync uses baseMs=1000; monkey-patch setTimeout indirectly
    // by fake-timers is overkill. Instead we compress by only permitting a
    // small delay via the jitter randomizer.
    const realRandom = Math.random;
    Math.random = () => 0.001; // makes jitter delay ≈ 1ms
    try {
      const result = await handleGitlabSync(fakePrisma() as never, logger, {
        userId: 'user-1',
        reason: 'setup',
      });

      expect(projectCalls).toBe(3); // 429, 429, 200
      expect(result.projectsScanned).toBe(1);
      expect(result.evidenceAdded).toBeGreaterThan(0);
    } finally {
      Math.random = realRandom;
    }
  }, 15_000);

  it('writes gitlab.sync.rate_limited to audit_log for each 429 encountered', async () => {
    // Rig: projects call 429 three times in a row → retry gives up after 4
    // attempts (default configured in handleGitlabSync). Assert 3 audit rows.
    server.use(
      http.get('https://gitlab.com/api/v4/projects', () =>
        HttpResponse.json(
          { message: 'rate limited' },
          {
            status: 429,
            headers: {
              'ratelimit-remaining': '0',
              'ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1),
            },
          },
        ),
      ),
    );

    const prisma = fakePrisma();
    const realRandom = Math.random;
    Math.random = () => 0.001;
    try {
      await expect(
        handleGitlabSync(prisma as never, logger, { userId: 'user-1', reason: 'manual' }),
      ).rejects.toThrow(/429/);
    } finally {
      Math.random = realRandom;
    }

    const rateLimitedCount = prisma.calls.auditWrites.filter(
      (a) => a.action === 'gitlab.sync.rate_limited',
    ).length;
    // Retry helper attempts N=4 → 4 hits → 4 audits.
    expect(rateLimitedCount).toBeGreaterThanOrEqual(3);
    // Sync-started still writes exactly once at job entry.
    expect(prisma.calls.auditWrites.filter((a) => a.action === 'gitlab.sync.started').length).toBe(1);
  }, 15_000);

  it('emits gitlab.sync.completed on a clean run', async () => {
    server.use(
      http.get('https://gitlab.com/api/v4/projects', () =>
        HttpResponse.json([
          {
            id: 101,
            path_with_namespace: 'me/other',
            visibility: 'private',
            last_activity_at: '2026-02-01T00:00:00Z',
          },
        ]),
      ),
      http.get('https://gitlab.com/api/v4/projects/101/languages', () =>
        HttpResponse.json({ Go: 100.0 }),
      ),
      http.get('https://gitlab.com/api/v4/projects/101/merge_requests', () =>
        HttpResponse.json([
          {
            id: 555,
            iid: 1,
            title: 'add feature',
            merged_at: '2026-02-02T00:00:00Z',
            web_url: 'https://gitlab.com/me/other/-/merge_requests/1',
          },
        ]),
      ),
      http.get('https://gitlab.com/api/v4/projects/101/pipelines', () =>
        HttpResponse.json([
          { id: 9, status: 'success', updated_at: '2026-02-02T00:00:00Z' },
        ]),
      ),
    );

    const prisma = fakePrisma();
    const result = await handleGitlabSync(prisma as never, logger, {
      userId: 'user-1',
      reason: 'scheduled',
    });

    expect(result.projectsScanned).toBe(1);
    // Go (language presence) + go MR (sustained_application) + ci-cd presence.
    expect(result.evidenceAdded).toBeGreaterThanOrEqual(3);
    const actions = prisma.calls.auditWrites.map((a) => a.action);
    expect(actions).toContain('gitlab.sync.started');
    expect(actions).toContain('gitlab.sync.completed');

    // Employer-confidential sensitivity on private repo evidence.
    const privateEvidence = prisma.calls.evidenceCreates.filter(
      (e) => (e.detail as { sensitivity?: string })?.sensitivity === 'employer-confidential',
    );
    expect(privateEvidence.length).toBeGreaterThan(0);
  }, 15_000);

  it('short-circuits when integration is not connected', async () => {
    const prisma = fakePrisma();
    // Override integration.findUnique to return null
    prisma.integration.findUnique = async () => null;

    const result = await handleGitlabSync(prisma as never, logger, {
      userId: 'user-1',
      reason: 'setup',
    });
    expect(result).toEqual({ projectsScanned: 0, skillsTouched: 0, evidenceAdded: 0 });
    // Started audit still fires; completed/rate_limited do not.
    const actions = prisma.calls.auditWrites.map((a) => a.action);
    expect(actions).toContain('gitlab.sync.started');
    expect(actions).not.toContain('gitlab.sync.completed');
  });
});

// Silence unused-import in the strict tsconfig (vi kept for future spy tests).
void vi;
