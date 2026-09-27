// E.4d: gmail-watch-renewal worker unit tests. Injects a fake Prisma + fake
// armWatch so we can drive every branch of refreshAllWatches without going
// near googleapis.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GMAIL_WATCH_RENEWAL_CRON,
  JOB_GMAIL_WATCH_RENEWAL,
  QUEUE_GMAIL_WATCH_RENEWAL,
  RENEWAL_WINDOW_MS,
  refreshAllWatches,
  type ArmWatch,
  type GmailRenewalRepo,
} from './gmail-watch-renewal.worker';

// Stub the loadMasterKey side-effect so importing this test file doesn't crash
// on machines without ENCRYPTION_KEY. vitest.setup.ts already seeds it but
// keeping it belt-and-suspenders here means the test file is stand-alone.
process.env.ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Prevent the `decrypt` call from crashing when tests pass a fake ciphertext.
// The real path decrypts the persisted secret; here we don't care about the
// value (the injected `armWatch` never reads it) so we short-circuit.
vi.mock('@careeros/secrets', () => ({
  loadMasterKey: () => new Uint8Array(32),
  decrypt: () => 'fake-refresh-token',
}));

const NOW = new Date('2026-10-15T03:00:00Z');

interface Watch {
  id: string;
  userId: string;
  historyId: string;
  expiration: Date;
  topicName: string;
}

function fakeRepo(initial: Watch[]) {
  const watches: Watch[] = [...initial];
  const audits: Array<{ userId: string; action: string; payload: unknown }> = [];
  const repo: GmailRenewalRepo = {
    gmailWatch: {
      findMany: async ({ where }) => watches.filter((w) => w.expiration < where.expiration.lt),
      update: async ({ where, data }) => {
        const idx = watches.findIndex((w) => w.userId === where.userId);
        if (idx < 0) throw new Error('not found');
        watches[idx] = { ...watches[idx]!, ...data };
        return {};
      },
    },
    integration: {
      findUnique: async ({ where }) => {
        const w = watches.find((x) => x.userId === where.userId_kind.userId);
        return w ? { tokenSecretId: `sec-${w.userId}`, status: 'connected' } : null;
      },
    },
    encryptedSecret: {
      findUnique: async () => ({ ciphertext: 'fake-ct' }),
    },
    auditEvent: {
      create: async ({ data }) => {
        audits.push({
          userId: data.userId as string,
          action: data.action as string,
          payload: data.payload,
        });
        return {};
      },
    },
  };
  return { repo, watches, audits };
}

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('gmail watch renewal cron identity', () => {
  it('jobId + queue name are stable across restarts', () => {
    expect(QUEUE_GMAIL_WATCH_RENEWAL).toBe('gmail-watch-renewal');
    expect(JOB_GMAIL_WATCH_RENEWAL).toBe('gmail-watch-renewal');
  });

  it('cron pattern is 03:00 UTC daily', () => {
    expect(GMAIL_WATCH_RENEWAL_CRON).toBe('0 3 * * *');
  });

  it('RENEWAL_WINDOW_MS is 24h', () => {
    expect(RENEWAL_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('refreshAllWatches', () => {
  it('re-arms every watch expiring within 24h', async () => {
    const { repo, watches, audits } = fakeRepo([
      {
        id: 'w1',
        userId: 'u1',
        historyId: '100',
        expiration: new Date(NOW.getTime() + 12 * 60 * 60 * 1000), // 12h out - IN
        topicName: 'projects/x/topics/gmail',
      },
      {
        id: 'w2',
        userId: 'u2',
        historyId: '200',
        expiration: new Date(NOW.getTime() + 6 * 60 * 60 * 1000), // 6h out - IN
        topicName: 'projects/x/topics/gmail',
      },
      {
        id: 'w3',
        userId: 'u3',
        historyId: '300',
        expiration: new Date(NOW.getTime() + 48 * 60 * 60 * 1000), // 48h out - OUT
        topicName: 'projects/x/topics/gmail',
      },
    ]);
    const arm: ArmWatch = async () => ({
      historyId: '9999',
      expiration: new Date(NOW.getTime() + 7 * 86_400_000),
    });

    const summary = await refreshAllWatches(repo, silentLogger(), NOW, arm);
    expect(summary.considered).toBe(2);
    expect(summary.renewed).toBe(2);
    expect(summary.failed).toBe(0);

    // Both in-window rows now carry the fresh historyId + expiration.
    expect(watches.find((w) => w.userId === 'u1')?.historyId).toBe('9999');
    expect(watches.find((w) => w.userId === 'u2')?.historyId).toBe('9999');
    // Out-of-window row untouched.
    expect(watches.find((w) => w.userId === 'u3')?.historyId).toBe('300');

    // Audit event dropped for each renewal.
    expect(audits.filter((a) => a.action === 'gmail.watch.renewed')).toHaveLength(2);
  });

  it('counts a per-user failure without aborting the run', async () => {
    const { repo, watches, audits } = fakeRepo([
      {
        id: 'w1',
        userId: 'u1',
        historyId: '100',
        expiration: new Date(NOW.getTime() + 12 * 60 * 60 * 1000),
        topicName: 'projects/x/topics/gmail',
      },
      {
        id: 'w2',
        userId: 'u2',
        historyId: '200',
        expiration: new Date(NOW.getTime() + 12 * 60 * 60 * 1000),
        topicName: 'projects/x/topics/gmail',
      },
    ]);
    let calls = 0;
    const arm: ArmWatch = async () => {
      calls++;
      if (calls === 1) throw new Error('gmail 401');
      return { historyId: 'ok', expiration: new Date(NOW.getTime() + 7 * 86_400_000) };
    };

    const summary = await refreshAllWatches(repo, silentLogger(), NOW, arm);
    expect(summary.considered).toBe(2);
    expect(summary.renewed).toBe(1);
    expect(summary.failed).toBe(1);
    // Only the successful renew wrote an audit event.
    expect(audits.filter((a) => a.action === 'gmail.watch.renewed')).toHaveLength(1);
  });

  it('skips users whose integration is not connected', async () => {
    const nowLocal = NOW;
    const watches: Watch[] = [
      {
        id: 'w1',
        userId: 'u-gone',
        historyId: '100',
        expiration: new Date(nowLocal.getTime() + 12 * 60 * 60 * 1000),
        topicName: 'projects/x/topics/gmail',
      },
    ];
    const repo: GmailRenewalRepo = {
      gmailWatch: {
        findMany: async () => watches,
        update: async () => ({}),
      },
      integration: {
        findUnique: async () => ({ tokenSecretId: null, status: 'revoked' }),
      },
      encryptedSecret: { findUnique: async () => null },
      auditEvent: { create: async () => ({}) },
    };
    const arm: ArmWatch = vi.fn(async () => ({
      historyId: 'x',
      expiration: new Date(),
    })) as unknown as ArmWatch;
    const summary = await refreshAllWatches(repo, silentLogger(), nowLocal, arm);
    expect(summary.renewed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(arm).not.toHaveBeenCalled();
  });
});
