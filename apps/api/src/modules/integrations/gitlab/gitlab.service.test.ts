// C-P1.6e: MSW-mocked GitLab responses. All A-H6b acceptance cases route
// through here (gitlab.com + self-hosted, PAT-scope accept, PAT-scope reject,
// SSRF reject, expired token). The service uses global fetch via safeFetch,
// so MSW intercepts at the network layer.
import { promises as dns } from 'node:dns';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import {
  GitlabService,
  InvalidGitlabBaseUrlError,
  InvalidGitlabTokenScopeError,
  classifyScopes,
} from './gitlab.service';

// MSW server (per-test handler registration).
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Route DNS lookup for self-hosted test hosts to a public IP so
// assertPublicUrl passes. gitlab.com goes through the real DNS but that's
// still not hit because MSW intercepts before fetch.
const realLookup = dns.lookup;
beforeAll(() => {
  (dns as unknown as { lookup: unknown }).lookup = async (
    host: string,
    opts?: { all?: boolean },
  ): Promise<unknown> => {
    const rec = { address: '198.51.100.10', family: 4 };
    if (host === 'gitlab.example.com' || host === 'gitlab.com') {
      return opts?.all ? [rec] : rec;
    }
    throw new Error(`unexpected dns lookup: ${host}`);
  };
});
afterAll(() => {
  (dns as unknown as { lookup: unknown }).lookup = realLookup;
});

// -----------------------------------------------------------------------------
// Fakes
// -----------------------------------------------------------------------------

function fakePrisma() {
  const secretUpserts: unknown[] = [];
  const integrationUpserts: unknown[] = [];
  const auditWrites: Array<{ userId: string; action: string; payload: unknown }> = [];
  return {
    calls: { secretUpserts, integrationUpserts, auditWrites },
    encryptedSecret: {
      upsert: async (args: unknown) => {
        secretUpserts.push(args);
        return { id: 'gl-secret-1' };
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
    enqueueGitlabSync: async (payload: { userId: string; reason: 'setup' | 'manual' | 'scheduled' }) => {
      enqueued.push(payload);
    },
  };
}

function buildService() {
  const prisma = fakePrisma();
  const queue = fakeQueue();
  const svc = new GitlabService(prisma as never, queue as never);
  return { svc, prisma, queue };
}

// Force NODE_ENV to development so http:// self-hosted URLs and localhost-like
// hosts are permitted by assertPublicUrl. Production semantics are still
// exercised by shape-only checks in packages/shared.
beforeEach(() => {
  process.env.NODE_ENV = 'development';
});

// -----------------------------------------------------------------------------
// MSW handler builders
// -----------------------------------------------------------------------------

function pat(baseUrl: string, scopes: string[], overrides: Partial<{ revoked: boolean; expires_at: string | null; active: boolean }> = {}) {
  return http.get(`${baseUrl}/api/v4/personal_access_tokens/self`, () =>
    HttpResponse.json({
      id: 1,
      name: 'careeros',
      revoked: overrides.revoked ?? false,
      active: overrides.active ?? true,
      scopes,
      expires_at: overrides.expires_at ?? null,
    }),
  );
}

function me(baseUrl: string) {
  return http.get(`${baseUrl}/api/v4/user`, () =>
    HttpResponse.json({
      id: 42,
      username: 'octocat',
      name: 'Octo',
      avatar_url: 'https://x/y.png',
      web_url: `${baseUrl}/octocat`,
    }),
  );
}

// -----------------------------------------------------------------------------
// A-H6b acceptance: gitlab.com happy + scope reject
// -----------------------------------------------------------------------------

describe('GitlabService.saveToken (gitlab.com, A-H6b)', () => {
  it('accepts a PAT with only allowed scopes', async () => {
    server.use(pat('https://gitlab.com', ['read_api', 'read_user', 'read_repository']));
    server.use(me('https://gitlab.com'));
    const { svc, prisma, queue } = buildService();

    const profile = await svc.saveToken('user-1', { pat: 'glpat-' + 'x'.repeat(30) });

    expect(profile.username).toBe('octocat');
    expect(prisma.calls.secretUpserts).toHaveLength(1);
    expect(prisma.calls.integrationUpserts).toHaveLength(1);
    expect(queue.calls.enqueued).toEqual([{ userId: 'user-1', reason: 'setup' }]);
    const savedActions = prisma.calls.auditWrites.map((a) => a.action);
    expect(savedActions).toContain('gitlab.token.saved');
    expect(savedActions).not.toContain('gitlab.token.rejected');
    // baseUrl stays null for the default gitlab.com case (avoids table churn).
    const upsert = prisma.calls.integrationUpserts[0] as { create: { baseUrl: string | null } };
    expect(upsert.create.baseUrl).toBeNull();
  });

  it('rejects a PAT that includes the api scope (blast-radius scope)', async () => {
    server.use(pat('https://gitlab.com', ['api', 'read_user']));
    const { svc, prisma, queue } = buildService();

    await expect(
      svc.saveToken('user-1', { pat: 'glpat-' + 'x'.repeat(30) }),
    ).rejects.toBeInstanceOf(InvalidGitlabTokenScopeError);

    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(prisma.calls.integrationUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites).toHaveLength(1);
    expect(prisma.calls.auditWrites[0]).toMatchObject({
      userId: 'user-1',
      action: 'gitlab.token.rejected',
      payload: { reason: 'blocked_scope', offendingScopes: ['api'] },
    });
  });

  it('rejects a PAT whose expires_at is in the past', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    server.use(
      pat('https://gitlab.com', ['read_api', 'read_user', 'read_repository'], {
        expires_at: yesterday,
      }),
    );
    const { svc, prisma, queue } = buildService();

    await expect(
      svc.saveToken('user-1', { pat: 'glpat-' + 'x'.repeat(30) }),
    ).rejects.toBeInstanceOf(InvalidGitlabTokenScopeError);

    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites[0].payload).toMatchObject({ reason: 'expired' });
  });

  it('rejects a revoked PAT', async () => {
    server.use(pat('https://gitlab.com', ['read_api'], { revoked: true }));
    const { svc, prisma, queue } = buildService();

    await expect(
      svc.saveToken('user-1', { pat: 'glpat-' + 'x'.repeat(30) }),
    ).rejects.toBeInstanceOf(InvalidGitlabTokenScopeError);

    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites[0].payload).toMatchObject({ reason: 'revoked' });
  });

  it('rejects a 401 with "invalid token" and audits the reject', async () => {
    server.use(
      http.get('https://gitlab.com/api/v4/personal_access_tokens/self', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
    );
    const { svc, prisma, queue } = buildService();

    await expect(
      svc.saveToken('user-1', { pat: 'glpat-' + 'x'.repeat(30) }),
    ).rejects.toThrow(/invalid gitlab token/i);
    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites[0]).toMatchObject({
      action: 'gitlab.token.rejected',
      payload: { reason: 'invalid_token' },
    });
  });
});

// -----------------------------------------------------------------------------
// A-C2 + A-H6b: self-hosted SSRF gate
// -----------------------------------------------------------------------------

describe('GitlabService.saveToken (self-hosted SSRF gate, A-C2 + A-H6b)', () => {
  it('rejects self-hosted baseUrl pointing at 169.254.169.254 (IMDS)', async () => {
    // No MSW handler needed: assertPublicUrlShape catches the private-IP literal
    // before any fetch fires. The user opts in to allowlist explicitly, which
    // exposes the SSRF check as the ONLY reason for reject (not "not opted in").
    const { svc, prisma, queue } = buildService();

    await expect(
      svc.saveToken('user-1', {
        pat: 'glpat-' + 'x'.repeat(30),
        baseUrl: 'http://169.254.169.254',
        allowlistOptIn: true,
      }),
    ).rejects.toBeInstanceOf(InvalidGitlabBaseUrlError);

    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites[0]).toMatchObject({
      action: 'gitlab.baseurl.ssrf_rejected',
    });
    // The reason is the raw SSRF label from packages/shared/net.
    const payload = prisma.calls.auditWrites[0].payload as { reason: string };
    expect(payload.reason).toMatch(/literal_private_ip|host_not_allowlisted|resolved_to_private_ip/);
  });

  it('rejects a non-default baseUrl when the user did NOT opt in to allowlist', async () => {
    const { svc, prisma, queue } = buildService();

    await expect(
      svc.saveToken('user-1', {
        pat: 'glpat-' + 'x'.repeat(30),
        baseUrl: 'https://gitlab.example.com',
        allowlistOptIn: false,
      }),
    ).rejects.toBeInstanceOf(InvalidGitlabBaseUrlError);
    expect(prisma.calls.auditWrites[0].payload).toMatchObject({
      reason: 'allowlist_opt_in_missing',
      host: 'gitlab.example.com',
    });
    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
  });

  it('accepts a self-hosted baseUrl when opted-in AND scopes pass, and stores baseUrl on the integration', async () => {
    server.use(
      pat('https://gitlab.example.com', ['read_api', 'read_user', 'read_repository']),
      me('https://gitlab.example.com'),
    );
    const { svc, prisma, queue } = buildService();

    const profile = await svc.saveToken('user-1', {
      pat: 'glpat-' + 'x'.repeat(30),
      baseUrl: 'https://gitlab.example.com',
      allowlistOptIn: true,
    });

    expect(profile.username).toBe('octocat');
    expect(prisma.calls.integrationUpserts).toHaveLength(1);
    const upsert = prisma.calls.integrationUpserts[0] as { create: { baseUrl: string } };
    expect(upsert.create.baseUrl).toBe('https://gitlab.example.com');
    expect(queue.calls.enqueued).toEqual([{ userId: 'user-1', reason: 'setup' }]);
  });

  it('rejects a self-hosted baseUrl with garbage URL shape', async () => {
    const { svc, prisma, queue } = buildService();

    await expect(
      svc.saveToken('user-1', {
        pat: 'glpat-' + 'x'.repeat(30),
        baseUrl: 'not-a-url',
        allowlistOptIn: true,
      }),
    ).rejects.toBeInstanceOf(InvalidGitlabBaseUrlError);

    expect(prisma.calls.secretUpserts).toHaveLength(0);
    expect(queue.calls.enqueued).toHaveLength(0);
    expect(prisma.calls.auditWrites[0].payload).toMatchObject({
      reason: 'invalid_url',
    });
  });
});

// -----------------------------------------------------------------------------
// Token round-trip: what we persist decrypts back to the plaintext PAT
// -----------------------------------------------------------------------------

describe('GitlabService.saveToken persistence', () => {
  it('persists an encrypted token that round-trips via @careeros/secrets', async () => {
    server.use(
      pat('https://gitlab.com', ['read_api', 'read_user', 'read_repository']),
      me('https://gitlab.com'),
    );
    const { svc, prisma } = buildService();
    const rawToken = 'glpat-' + 'a'.repeat(30);

    await svc.saveToken('user-42', { pat: rawToken });

    const upsert = prisma.calls.secretUpserts[0] as {
      create: { ciphertext: string; purpose: string };
    };
    expect(upsert.create.ciphertext).not.toContain(rawToken);
    expect(upsert.create.ciphertext.length).toBeGreaterThan(rawToken.length);
    expect(upsert.create.purpose).toBe('integration:gitlab:token');
    expect(decrypt(upsert.create.ciphertext, loadMasterKey(), 'integration:gitlab:token')).toBe(
      rawToken,
    );
  });
});

// -----------------------------------------------------------------------------
// Pure classifier coverage — cheaper than MSW for the truth table.
// -----------------------------------------------------------------------------

describe('classifyScopes (pure)', () => {
  it('null when scopes are the exact allowed set', () => {
    expect(
      classifyScopes({ scopes: ['read_api', 'read_user', 'read_repository'], revoked: false, expires_at: null }),
    ).toBeNull();
  });

  it('rejects blocked scopes (api / write_repository / sudo)', () => {
    for (const scope of ['api', 'write_repository', 'sudo', 'admin_mode']) {
      const v = classifyScopes({ scopes: [scope], revoked: false, expires_at: null });
      expect(v?.reason).toBe('blocked_scope');
      expect(v?.offending).toEqual([scope]);
    }
  });

  it('rejects a disallowed non-blocked scope (not in allow set, not blocked)', () => {
    const v = classifyScopes({ scopes: ['read_registry'], revoked: false, expires_at: null });
    expect(v?.reason).toBe('disallowed_scope');
    expect(v?.offending).toEqual(['read_registry']);
  });

  it('rejects revoked ahead of scope check', () => {
    const v = classifyScopes({ scopes: ['api'], revoked: true, expires_at: null });
    expect(v?.reason).toBe('revoked');
  });

  it('rejects inactive ahead of scope check', () => {
    const v = classifyScopes({ scopes: ['read_api'], revoked: false, expires_at: null, active: false });
    expect(v?.reason).toBe('inactive');
  });

  it('rejects an expired PAT before checking scopes', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const v = classifyScopes(
      { scopes: ['api'], revoked: false, expires_at: past },
      new Date(),
    );
    expect(v?.reason).toBe('expired');
  });

  it('null when expires_at is in the future', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(
      classifyScopes({
        scopes: ['read_api', 'read_user', 'read_repository'],
        revoked: false,
        expires_at: future,
      }),
    ).toBeNull();
  });

  it('rejects empty scopes array with no_scopes reason', () => {
    const v = classifyScopes({ scopes: [], revoked: false, expires_at: null });
    expect(v?.reason).toBe('no_scopes');
  });
});

// -----------------------------------------------------------------------------
// Mutation smoke notes (C-P1.6e):
//   * Flip `!res.ok` to `res.ok` in fetchTokenAndProfile → happy-path test fails
//     because a 401 stub would now be treated as success.
//   * Delete the `!input.allowlistOptIn` branch → self-hosted-without-opt-in test
//     fails because the SSRF-reject audit isn't written.
//   * Change `BLOCKED_SCOPES.has(s)` to `.has(s.toLowerCase())` → will not flip
//     any of these tests because GitLab returns lowercase anyway, but the
//     invariant is that a mixed-case `Api` would slip through — add a case if
//     you want to lock that ceiling too.
//   * Remove the `await recordAudit` in the SSRF reject branch → assertion on
//     `auditWrites[0]` fails.
//   * Move `enqueueGitlabSync` BEFORE the scope-gate await → the api-scope
//     reject test fails because queue.calls.enqueued has one entry.
//   * Persist the raw PAT instead of encrypt() → decrypt round-trip test fails.
// -----------------------------------------------------------------------------
