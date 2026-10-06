import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials(): void {
          /* no-op */
        }
      },
    },
    gmail: () => ({ users: { drafts: { send: sendMock } } }),
  },
}));

import { encrypt, loadMasterKey } from '@careeros/secrets';
import { handleOutreachSend } from './outreach-send.worker';

const KEY = loadMasterKey();
const PURPOSE = 'integration:gmail:oauth';

function logger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as Logger;
}

interface FakeDb {
  outreachMessage: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  integration: { findUnique: ReturnType<typeof vi.fn> };
  encryptedSecret: { findUnique: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
}

function fakeDb(row: { id: string; status: string; gmailDraftId: string | null }): FakeDb {
  return {
    outreachMessage: {
      findFirst: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue(row),
    },
    integration: {
      findUnique: vi.fn().mockResolvedValue({ status: 'connected', tokenSecretId: 'sec-1' }),
    },
    encryptedSecret: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ ciphertext: encrypt('refresh-token', KEY, PURPOSE) }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
}

const data = { userId: 'u-1', outreachMessageId: 'o-1' };

beforeEach(() => {
  process.env.GMAIL_OAUTH_CLIENT_ID = 'cid';
  process.env.GMAIL_OAUTH_CLIENT_SECRET = 'csecret';
  process.env.GMAIL_OAUTH_REDIRECT_URI = 'https://x/cb';
  sendMock.mockReset();
});

afterEach(() => {
  sendMock.mockReset();
});

describe('handleOutreachSend', () => {
  it('skips when the row is missing', async () => {
    const db = fakeDb({ id: 'o-1', status: 'approved', gmailDraftId: 'd1' });
    db.outreachMessage.findFirst.mockResolvedValue(null);
    const res = await handleOutreachSend(db as unknown as PrismaClient, logger(), data);
    expect(res).toMatchObject({ ok: false, skipped: true, reason: 'not-found' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips an already-sent row (idempotent re-run)', async () => {
    const db = fakeDb({ id: 'o-1', status: 'sent', gmailDraftId: 'd1' });
    const res = await handleOutreachSend(db as unknown as PrismaClient, logger(), data);
    expect(res).toMatchObject({ ok: true, skipped: true, reason: 'already-sent' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips when no draft is staged', async () => {
    const db = fakeDb({ id: 'o-1', status: 'approved', gmailDraftId: null });
    const res = await handleOutreachSend(db as unknown as PrismaClient, logger(), data);
    expect(res).toMatchObject({ ok: false, skipped: true, reason: 'no-draft' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends the staged draft, flips status to sent, and audits', async () => {
    const db = fakeDb({ id: 'o-1', status: 'approved', gmailDraftId: 'draft-9' });
    sendMock.mockResolvedValue({ data: { id: 'msg-9', threadId: 'thread-9' } });
    const res = await handleOutreachSend(db as unknown as PrismaClient, logger(), data);
    expect(res).toMatchObject({ ok: true, gmailMessageId: 'msg-9' });
    expect(sendMock).toHaveBeenCalledWith({ userId: 'me', requestBody: { id: 'draft-9' } });
    expect(db.outreachMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'sent' }) }),
    );
    expect(db.auditEvent.create).toHaveBeenCalledOnce();
  });

  it('throws when the Gmail env is missing', async () => {
    delete process.env.GMAIL_OAUTH_CLIENT_ID;
    const db = fakeDb({ id: 'o-1', status: 'approved', gmailDraftId: 'draft-9' });
    await expect(
      handleOutreachSend(db as unknown as PrismaClient, logger(), data),
    ).rejects.toThrow(/Gmail env missing/);
  });
});
