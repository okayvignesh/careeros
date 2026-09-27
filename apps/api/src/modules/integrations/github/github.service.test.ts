import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
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
});
