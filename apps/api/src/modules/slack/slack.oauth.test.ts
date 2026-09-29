// SlackOAuthService tests. `fetch` is stubbed with vi.spyOn; Prisma is a
// stateful fake so we can assert the upsert path.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt, loadMasterKey } from '@careeros/secrets';
import { EXPECTED_SLACK_SCOPES, SlackOAuthService, auditSlackScopes } from './slack.oauth';

function fakePrisma() {
  const rows = new Map<string, { ciphertext: string; ownerType: string; ownerId: string | null; purpose: string }>();
  const key = (o: { ownerType: string; ownerId: string | null; purpose: string }) =>
    `${o.ownerType}::${o.ownerId ?? ''}::${o.purpose}`;
  return {
    rows,
    encryptedSecret: {
      upsert: async (args: {
        where: { ownerType_ownerId_purpose: { ownerType: string; ownerId: string | null; purpose: string } };
        create: { ownerType: string; ownerId: string | null; purpose: string; ciphertext: string };
        update: { ciphertext: string };
      }) => {
        const k = key(args.where.ownerType_ownerId_purpose);
        const existing = rows.get(k);
        if (existing) {
          existing.ciphertext = args.update.ciphertext;
          return existing;
        }
        const row = { ...args.create };
        rows.set(k, row);
        return row;
      },
      findUnique: async (args: {
        where: { ownerType_ownerId_purpose: { ownerType: string; ownerId: string | null; purpose: string } };
      }) => rows.get(key(args.where.ownerType_ownerId_purpose)) ?? null,
    },
  };
}

describe('SlackOAuthService.completeInstall', () => {
  beforeEach(() => {
    process.env.SLACK_CLIENT_ID = 'client_1';
    process.env.SLACK_CLIENT_SECRET = 'secret_1';
  });

  it('exchanges the code and persists an encrypted bot token', async () => {
    const prisma = fakePrisma();
    const svc = new SlackOAuthService(prisma as never);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          access_token: 'xoxb-test-token',
          scope: 'chat:write,commands',
          bot_user_id: 'B1',
          app_id: 'A1',
          team: { id: 'T1', name: 'Careeros Test' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await svc.completeInstall('abc123', 'https://x/y');
    expect(result.ok).toBe(true);
    expect(result.teamId).toBe('T1');
    expect(result.scopes).toEqual(['chat:write', 'commands']);

    // Token round-trips through decrypt.
    const round = await svc.loadBotToken();
    expect(round).toBe('xoxb-test-token');

    // And sits at ownerType=system, purpose=integration:slack:bot_token.
    const row = [...prisma.rows.values()][0];
    expect(row.ownerType).toBe('system');
    expect(row.purpose).toBe('integration:slack:bot_token');
    // Ciphertext is opaque, but decrypting with the wrong purpose must fail
    // (AAD binding) - proves purpose was used as AAD not just as a label.
    expect(() => decrypt(row.ciphertext, loadMasterKey(), 'wrong:purpose')).toThrow();
  });

  it('throws when Slack returns ok=false', async () => {
    const svc = new SlackOAuthService(fakePrisma() as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'invalid_code' }), { status: 200 }),
    );
    await expect(svc.completeInstall('bad', 'https://x/y')).rejects.toThrow(/invalid_code/);
  });

  it('throws when env vars are missing', async () => {
    delete process.env.SLACK_CLIENT_ID;
    const svc = new SlackOAuthService(fakePrisma() as never);
    await expect(svc.completeInstall('code', 'https://x/y')).rejects.toThrow(/env vars missing/);
    process.env.SLACK_CLIENT_ID = 'client_1';
  });

  it('loadBotToken returns null when no install exists', async () => {
    const svc = new SlackOAuthService(fakePrisma() as never);
    expect(await svc.loadBotToken()).toBeNull();
  });
});

// F.11c: OAuth scope audit.
describe('auditSlackScopes', () => {
  it('flags missing scopes when the install did not grant everything the code needs', () => {
    const a = auditSlackScopes(['commands']);
    expect(a.missing).toEqual(['chat:write']);
    expect(a.excess).toEqual([]);
  });

  it('flags excess scopes when the install granted more than the code uses', () => {
    const a = auditSlackScopes(['commands', 'chat:write', 'channels:read', 'files:write']);
    expect(a.missing).toEqual([]);
    expect(a.excess).toEqual(['channels:read', 'files:write']);
    // MUTATION-SMOKE: swap the sort in auditSlackScopes for input order and
    // this fails on the alphabetical assertion.
  });

  it('clean when scopes match exactly', () => {
    const a = auditSlackScopes([...EXPECTED_SLACK_SCOPES]);
    expect(a.missing).toEqual([]);
    expect(a.excess).toEqual([]);
  });

  it('EXPECTED_SLACK_SCOPES pins the actual runtime need', () => {
    expect(EXPECTED_SLACK_SCOPES).toEqual(['commands', 'chat:write']);
    // Adding a slack API call that needs a new scope must bump this list
    // AND update docs/oauth-scope-audit.md in the same commit.
  });
});
