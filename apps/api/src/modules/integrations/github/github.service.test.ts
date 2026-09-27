import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { GithubService, InvalidTokenScopeError, classifyScopes, parseScopeHeader } from './github.service';

// MSW-mocked GitHub responses. All A-H6 acceptance cases route through here.
// The service uses global `fetch`, so intercepting at the network layer covers
// the entire code path (headers, status, body) without stubbing fetch itself.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Minimal Prisma fake. Records whether the persist path or the audit path was
// invoked so we can assert the scope-gate blocked the write.
function fakePrisma() {
  const secretUpserts: unknown[] = [];
  const integrationUpserts: unknown[] = [];
  const auditWrites: Array<{ userId: string; action: string; payload: unknown }> = [];
  return {
    calls: { secretUpserts, integrationUpserts, auditWrites },
    encryptedSecret: {
      upsert: async (args: unknown) => {
        secretUpserts.push(args);
        return { id: 'secret-1' };
      },
    },
    integration: {
      upsert: async (args: unknown) => {
        integrationUpserts.push(args);
        return {};
      },
    },
    auditEvent: {
      create: async ({ data }: { data: { userId: string; action: string; payload: unknown } }) => {
        auditWrites.push({ userId: data.userId, action: data.action, payload: data.payload });
        return {};
      },
    },
  };
}

function fakeQueue() {
  const enqueued: Array<{ userId: string; reason: string }> = [];
  return {
    calls: { enqueued },
    enqueueGithubSync: async (payload: { userId: string; reason: 'setup' | 'manual' | 'scheduled' }) => {
      enqueued.push(payload);
    },
  };
}

function buildService() {
  const prisma = fakePrisma();
  const queue = fakeQueue();
  const svc = new GithubService(prisma as never, queue as never);
  return { svc, prisma, queue };
}

// A well-formed /user response so scope-gate is the only variable per test.
const userBody = {
  login: 'octocat',
  name: 'Mona',
  avatar_url: 'https://x/y.png',
  public_repos: 3,
  followers: 10,
};

function githubUser(headers: Record<string, string>): ReturnType<typeof http.get> {
  return http.get('https://api.github.com/user', () =>
    HttpResponse.json(userBody, { headers }),
  );
}

describe('GithubService.saveToken scope gate (A-H6)', () => {
  it('accepts a classic PAT with only allowed scopes', async () => {
    server.use(githubUser({ 'x-oauth-scopes': 'repo, read:user' }));
    const { svc, prisma, queue } = buildService();

    const profile = await svc.saveToken('user-1', 'ghp_' + 'x'.repeat(36));

    expect(profile.login).toBe('octocat');
    expect(prisma.calls.secretUpserts).toHaveLength(1);
    expect(prisma.calls.integrationUpserts).toHaveLength(1);
    expect(queue.calls.enqueued).toEqual([{ userId: 'user-1', reason: 'setup' }]);
    expect(prisma.calls.auditWrites).toHaveLength(0);
  });

  it('rejects a PAT with workflow scope; no persist, no sync, audit written', async () => {
    server.use(githubUser({ 'x-oauth-scopes': 'repo, workflow' }));
    const { svc, prisma, queue } = buildService();

    await expect(svc.saveToken('user-1', 'ghp_' + 'x'.repeat(36))).rejects.toBeInstanceOf(
      InvalidTokenScopeError,
    );

    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(prisma.calls.integrationUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites).toHaveLength(1);
    expect(prisma.calls.auditWrites[0]).toMatchObject({
      userId: 'user-1',
      action: 'github.token.rejected',
      payload: { reason: 'blocked_scope', offendingScopes: ['workflow'] },
    });
  });

  it('rejects a PAT with admin:org scope', async () => {
    server.use(githubUser({ 'x-oauth-scopes': 'admin:org' }));
    const { svc, prisma, queue } = buildService();

    await expect(svc.saveToken('user-1', 'ghp_' + 'x'.repeat(36))).rejects.toBeInstanceOf(
      InvalidTokenScopeError,
    );
    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites[0].payload).toMatchObject({
      reason: 'blocked_scope',
      offendingScopes: ['admin:org'],
    });
  });

  it('rejects a fine-grained PAT (empty x-oauth-scopes) for MVP', async () => {
    server.use(githubUser({ 'x-oauth-scopes': '' }));
    const { svc, prisma, queue } = buildService();

    await expect(svc.saveToken('user-1', 'github_pat_' + 'x'.repeat(36))).rejects.toBeInstanceOf(
      InvalidTokenScopeError,
    );
    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites[0].payload).toMatchObject({
      reason: 'fine_grained_not_supported',
    });
  });

  it('rejects a 401 with "invalid token" (not "network error")', async () => {
    server.use(
      http.get('https://api.github.com/user', () =>
        HttpResponse.json({ message: 'Bad credentials' }, { status: 401 }),
      ),
    );
    const { svc, prisma, queue } = buildService();

    await expect(svc.saveToken('user-1', 'ghp_' + 'x'.repeat(36))).rejects.toThrow(
      /invalid github token/i,
    );
    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites[0]).toMatchObject({
      action: 'github.token.rejected',
      payload: { reason: 'invalid_token' },
    });
  });

  it('rejects when x-oauth-scopes is absent entirely', async () => {
    // MSW: no scope header on the response at all.
    server.use(http.get('https://api.github.com/user', () => HttpResponse.json(userBody)));
    const { svc, prisma, queue } = buildService();

    await expect(svc.saveToken('user-1', 'ghp_' + 'x'.repeat(36))).rejects.toBeInstanceOf(
      InvalidTokenScopeError,
    );
    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
  });
});

// Pure-function coverage: keeps the policy testable without spinning up MSW
// for every combination.
describe('classifyScopes', () => {
  it('accepts allowed-only scope set', () => {
    expect(classifyScopes('repo, read:user', ['repo', 'read:user'])).toBeNull();
    expect(classifyScopes('public_repo', ['public_repo'])).toBeNull();
  });

  it('rejects any blocked scope with the offenders listed', () => {
    const v = classifyScopes('repo, workflow, admin:org', ['repo', 'workflow', 'admin:org']);
    expect(v?.reason).toBe('blocked_scope');
    expect(v?.offending).toEqual(['workflow', 'admin:org']);
  });

  it('rejects scopes outside the allowlist even when not on the blocklist', () => {
    const v = classifyScopes('repo, notify', ['repo', 'notify']);
    expect(v?.reason).toBe('disallowed_scope');
    expect(v?.offending).toEqual(['notify']);
  });

  it('rejects empty header (fine-grained)', () => {
    expect(classifyScopes('', [])?.reason).toBe('fine_grained_not_supported');
  });

  it('rejects missing header', () => {
    expect(classifyScopes(null, [])?.reason).toBe('missing_scope_header');
  });
});

describe('parseScopeHeader', () => {
  it('splits comma-separated with surrounding whitespace', () => {
    expect(parseScopeHeader('repo, read:user , user:email')).toEqual([
      'repo',
      'read:user',
      'user:email',
    ]);
  });

  it('returns [] for null / empty', () => {
    expect(parseScopeHeader(null)).toEqual([]);
    expect(parseScopeHeader('')).toEqual([]);
    expect(parseScopeHeader('   ')).toEqual([]);
  });

  // B-6 additions: header shapes GitHub has been observed to emit and one we
  // decided to reject deliberately. Each doubles as a mutation smoke against
  // the parser: swap `.split(',')` for `.split(/[,\s]+/)` and the trailing-comma
  // case still passes but the "REPO" case (below in classifyScopes) breaks.
  it('drops empty segments from trailing / doubled commas', () => {
    expect(parseScopeHeader('repo,,read:user,')).toEqual(['repo', 'read:user']);
    expect(parseScopeHeader(',repo,')).toEqual(['repo']);
  });

  it('preserves scope-name case verbatim (no lowercasing)', () => {
    // GitHub always returns lowercase in practice; if it ever emits mixed case
    // the parser must NOT silently lowercase, otherwise the allowlist check
    // would rubber-stamp e.g. "Admin:Org".
    expect(parseScopeHeader('Repo, Read:User')).toEqual(['Repo', 'Read:User']);
  });
});

describe('classifyScopes case sensitivity (B-6)', () => {
  it('rejects mixed-case variants of allowed scopes (allowlist is case-strict)', () => {
    const v = classifyScopes('REPO, Read:User', ['REPO', 'Read:User']);
    expect(v?.reason).toBe('disallowed_scope');
    expect(v?.offending).toEqual(['REPO', 'Read:User']);
  });
});

// B-6: happy-path persistence assertions beyond the A-H6 acceptance test —
// specifically that the token round-trips through `packages/secrets` encryption
// and lands in `EncryptedSecret.ciphertext`, then is referenced by the
// Integration row, and only THEN does the sync job fire.
describe('GithubService.saveToken happy-path persistence (B-6)', () => {
  it('persists an encrypted token (round-trips through @careeros/secrets)', async () => {
    server.use(githubUser({ 'x-oauth-scopes': 'repo, read:user' }));
    const { svc, prisma } = buildService();
    const rawToken = 'ghp_' + 'a'.repeat(36);

    await svc.saveToken('user-42', rawToken);

    expect(prisma.calls.secretUpserts).toHaveLength(1);
    const secretUpsert = prisma.calls.secretUpserts[0] as {
      where: { ownerType_ownerId_purpose: { ownerType: string; ownerId: string; purpose: string } };
      create: { ciphertext: string; purpose: string; ownerType: string; ownerId: string };
    };
    // Scoped to the user + purpose so a second connect swaps ciphertext, not table-wide.
    expect(secretUpsert.where.ownerType_ownerId_purpose).toEqual({
      ownerType: 'user',
      ownerId: 'user-42',
      purpose: 'integration:github:token',
    });
    // Ciphertext is not the plaintext token.
    expect(secretUpsert.create.ciphertext).not.toContain(rawToken);
    expect(secretUpsert.create.ciphertext.length).toBeGreaterThan(rawToken.length);
    // And it MUST decrypt back to the exact token with the same purpose binding.
    const decrypted = decrypt(secretUpsert.create.ciphertext, loadMasterKey(), 'integration:github:token');
    expect(decrypted).toBe(rawToken);
  });

  it('links Integration.tokenSecretId to the persisted secret, THEN enqueues sync', async () => {
    server.use(githubUser({ 'x-oauth-scopes': 'repo, read:user' }));
    const { svc, prisma, queue } = buildService();

    await svc.saveToken('user-42', 'ghp_' + 'b'.repeat(36));

    const integrationUpsert = prisma.calls.integrationUpserts[0] as {
      where: { userId_kind: { userId: string; kind: string } };
      create: { tokenSecretId: string; status: string; kind: string; userId: string };
    };
    expect(integrationUpsert.where.userId_kind).toEqual({ userId: 'user-42', kind: 'github' });
    expect(integrationUpsert.create.status).toBe('connected');
    // The fake `encryptedSecret.upsert` returns { id: 'secret-1' } — the service
    // must thread THAT id into the integration row, not fabricate one.
    expect(integrationUpsert.create.tokenSecretId).toBe('secret-1');

    // Sync is enqueued exactly once, with reason: 'setup' (wizard trigger), not 'manual'.
    expect(queue.calls.enqueued).toEqual([{ userId: 'user-42', reason: 'setup' }]);
  });

  it('does NOT enqueue sync when scope-gate rejects', async () => {
    // Regression against a bug where an early implementation enqueued sync
    // eagerly in parallel with the scope check.
    server.use(githubUser({ 'x-oauth-scopes': 'repo, workflow' }));
    const { svc, queue } = buildService();

    await expect(svc.saveToken('user-42', 'ghp_' + 'c'.repeat(36))).rejects.toBeInstanceOf(
      InvalidTokenScopeError,
    );
    expect(queue.calls.enqueued).toHaveLength(0);
  });
});

// B-6: rate-limit path. Today the service surfaces 429 as a generic
// `BadRequestException('GitHub returned 429')` with NO retry and NO typed
// `GitHubRateLimitError`. These tests pin CURRENT behaviour and document the
// gap; when a typed error + backoff lands, flip the expectations here.
// ponytail: pinning today's behaviour; upgrade path is a `GitHubRateLimitError`
// carrying `X-RateLimit-Reset` and one retry after the reset.
describe('GithubService.saveToken rate-limit path (B-6)', () => {
  it('surfaces 429 as an error and does NOT persist or enqueue', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 60;
    server.use(
      http.get('https://api.github.com/user', () =>
        HttpResponse.json(
          { message: 'API rate limit exceeded' },
          {
            status: 429,
            headers: {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(resetAt),
              'retry-after': '60',
            },
          },
        ),
      ),
    );
    const { svc, prisma, queue } = buildService();

    await expect(svc.saveToken('user-1', 'ghp_' + 'x'.repeat(36))).rejects.toThrow(/429/);

    // No side effects on rate-limit — critical: we must not persist a token
    // that hasn't been validated, and we must not enqueue sync for a token
    // whose scopes we never inspected.
    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(prisma.calls.integrationUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    // 429 is not currently written to audit_log (only 401 and scope rejects are).
    // Pins the gap; move to `toHaveLength(1)` when audit is added.
    expect(prisma.calls.auditWrites).toHaveLength(0);
  });

  it('does NOT retry the /user request on 429 (single call observed)', async () => {
    // MSW handler that would flip to 200 on second call — the service should
    // NOT reach the 200. If a retry lands later, this test flips to expect >=2.
    let calls = 0;
    server.use(
      http.get('https://api.github.com/user', () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { message: 'rate limited' },
            { status: 429, headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1) } },
          );
        }
        return HttpResponse.json(userBody, { headers: { 'x-oauth-scopes': 'repo, read:user' } });
      }),
    );
    const { svc } = buildService();
    await expect(svc.saveToken('user-1', 'ghp_' + 'x'.repeat(36))).rejects.toThrow(/429/);
    expect(calls).toBe(1);
  });

  it('surfaces non-429 5xx as a generic error and does NOT persist', async () => {
    server.use(
      http.get('https://api.github.com/user', () =>
        HttpResponse.json({ message: 'boom' }, { status: 503 }),
      ),
    );
    const { svc, prisma, queue } = buildService();
    await expect(svc.saveToken('user-1', 'ghp_' + 'x'.repeat(36))).rejects.toThrow(/503/);
    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
  });
});

// B-6: retry helper contract, exercised via a fake HTTP fn that mimics what a
// wrapped Octokit call SHOULD do. The github-sync worker does not currently
// route through `retry()` (see B-6 report bug note), so this locks the shared
// retry semantics that the worker WILL adopt: 429 retried up to N=3 then gives up.
describe('packages/shared/retry semantics under GitHub 429 (B-6)', () => {
  it('retries a 429 up to attempts=3 then throws the last error', async () => {
    const { retry } = await import('@careeros/shared');
    let calls = 0;
    const fn = async () => {
      calls += 1;
      const err = new Error('rate limited') as Error & { status: number };
      err.status = 429;
      throw err;
    };
    await expect(
      retry(fn, { attempts: 3, baseMs: 1, factor: 1, maxMs: 1 }),
    ).rejects.toThrow(/rate limited/);
    expect(calls).toBe(3);
  });

  it('stops retrying and returns as soon as the call succeeds', async () => {
    const { retry } = await import('@careeros/shared');
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 2) {
        const err = new Error('rate limited') as Error & { status: number };
        err.status = 429;
        throw err;
      }
      return { ok: true };
    };
    const out = await retry(fn, { attempts: 3, baseMs: 1, factor: 1, maxMs: 1 });
    expect(out).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('does NOT retry a 4xx that is not 429 (e.g. 401 dead token)', async () => {
    const { retry } = await import('@careeros/shared');
    let calls = 0;
    const fn = async () => {
      calls += 1;
      const err = new Error('bad credentials') as Error & { status: number };
      err.status = 401;
      throw err;
    };
    await expect(
      retry(fn, { attempts: 3, baseMs: 1, factor: 1, maxMs: 1 }),
    ).rejects.toThrow(/bad credentials/);
    expect(calls).toBe(1);
  });

  it('fires onRetry once per backoff so callers can log the 429 reset window', async () => {
    const { retry } = await import('@careeros/shared');
    const onRetry: Array<{ attempt: number; status: number }> = [];
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 3) {
        const err = new Error('rate limited') as Error & { status: number };
        err.status = 429;
        throw err;
      }
      return 'done';
    };
    const out = await retry(fn, {
      attempts: 3,
      baseMs: 1,
      factor: 1,
      maxMs: 1,
      onRetry: (err, attempt) => {
        onRetry.push({ attempt, status: (err as { status: number }).status });
      },
    });
    expect(out).toBe('done');
    // Two failures before the success → two onRetry callbacks.
    expect(onRetry).toEqual([
      { attempt: 1, status: 429 },
      { attempt: 2, status: 429 },
    ]);
  });
});

// MUTATION SMOKE (B-6 additions):
//  * "drops empty segments from trailing / doubled commas" → change `.filter((s) => s.length > 0)`
//    in parseScopeHeader to `.filter(() => true)` → assertion for ['repo', 'read:user'] fails,
//    receives ['repo', '', 'read:user', ''].
//  * "preserves scope-name case verbatim" → add `.toLowerCase()` in parseScopeHeader map
//    → assertion for ['Repo', 'Read:User'] fails, receives ['repo', 'read:user'].
//  * "rejects mixed-case variants of allowed scopes" → change `ALLOWED_SCOPES.has(s)` to
//    `ALLOWED_SCOPES.has(s.toLowerCase())` → violation becomes null → test fails on `.reason`.
//  * "persists an encrypted token" → change `encrypt(token, KEY, PURPOSE)` to `token` (plain)
//    → decrypt() at end throws (auth-tag mismatch), test fails.
//  * "persists an encrypted token" (purpose binding) → change PURPOSE to any other string
//    → decrypt() with 'integration:github:token' throws, test fails.
//  * "links Integration.tokenSecretId … THEN enqueues sync" → change `tokenSecretId: secret.id`
//    to `tokenSecretId: 'wrong'` → test fails on the 'secret-1' expectation.
//  * "does NOT enqueue sync when scope-gate rejects" → move `enqueueGithubSync` call BEFORE
//    the `fetchUser` await → queue.enqueued becomes length 1, test fails.
//  * "surfaces 429 as an error and does NOT persist or enqueue" → change the 429 branch to
//    fall-through (drop the `!res.ok` guard) → JSON parse of error body throws differently,
//    or worse the persist path runs; test fails on secretUpserts length.
//  * "does NOT retry the /user request on 429" → wrap `fetchUser` in retry() → calls becomes
//    2 or 3, test fails on `calls === 1`.
//  * "surfaces non-429 5xx" → same shape as 429; changing 503 handling to retry breaks it.
//  * retry "retries a 429 up to attempts=3" → change `attempt === attempts` to `attempt === 1`
//    → calls stops at 1, expectation of 3 fails.
//  * retry "stops as soon as call succeeds" → remove the `return await fn()` and always retry
//    → calls climbs past 2, expectation fails.
//  * retry "does NOT retry a 4xx that is not 429" → change defaultShouldRetry to return true
//    for all → calls climbs to 3, expectation of 1 fails.
//  * retry "fires onRetry once per backoff" → drop the `opts.onRetry?.()` call → onRetry stays
//    empty, expectation of two entries fails.
