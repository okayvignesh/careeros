import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { encrypt, loadMasterKey } from '@careeros/secrets';

const { draftsCreate, draftsSend, messagesSend } = vi.hoisted(() => ({
  draftsCreate: vi.fn(),
  draftsSend: vi.fn(),
  messagesSend: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials(): void {
          /* no-op */
        }
      },
    },
    gmail: () => ({
      users: {
        drafts: { create: draftsCreate, send: draftsSend },
        messages: { send: messagesSend },
      },
    }),
  },
}));

import { GmailAuthService } from './gmail.auth';
import { GmailOutboundService } from './gmail.outbound.service';

const KEY = loadMasterKey();
const PURPOSE = 'integration:gmail:oauth';

function fakePrisma() {
  const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
  const prisma = {
    integration: {
      findUnique: vi.fn().mockResolvedValue({ status: 'connected', tokenSecretId: 'sec-1' }),
    },
    encryptedSecret: {
      findUnique: vi.fn().mockResolvedValue({ ciphertext: encrypt('refresh', KEY, PURPOSE) }),
    },
    auditEvent: { create: auditCreate },
  } as unknown as PrismaService;
  return { prisma, auditCreate };
}

/** In-memory Redis double (same shape used by the Slack tests). */
function redisStub() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    quit: vi.fn(async () => 'OK'),
    on: vi.fn(),
  };
}

function build() {
  const { prisma, auditCreate } = fakePrisma();
  const auth = new GmailAuthService(prisma);
  const svc = new GmailOutboundService(prisma, auth);
  const redis = redisStub();
  Object.assign(svc as unknown as { redis: unknown }, { redis });
  return { svc, redis, auditCreate };
}

/** Decode the base64url `raw` field of a Gmail API message body. */
function decodeRaw(arg: { requestBody: { raw: string } }): string {
  return Buffer.from(arg.requestBody.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8',
  );
}

beforeEach(() => {
  process.env.GMAIL_OAUTH_CLIENT_ID = 'cid';
  process.env.GMAIL_OAUTH_CLIENT_SECRET = 'csecret';
  process.env.GMAIL_OAUTH_REDIRECT_URI = 'https://x/cb';
  process.env.GMAIL_PUBSUB_TOPIC = 'projects/p/topics/t';
  process.env.GMAIL_PUBSUB_AUDIENCE = 'https://x/push';
  draftsCreate.mockReset();
  draftsSend.mockReset();
  messagesSend.mockReset();
});

describe('GmailOutboundService.createDraft', () => {
  it('sends a base64url MIME message and returns the draft ids', async () => {
    draftsCreate.mockResolvedValue({
      data: { id: 'draft-1', message: { id: 'msg-1', threadId: 'thread-1' } },
    });
    const { svc } = build();
    const res = await svc.createDraft('u-1', {
      to: 'jane@acme.com',
      subject: 'Hello',
      body: 'Hi there',
    });
    expect(res).toEqual({ draftId: 'draft-1', messageId: 'msg-1', threadId: 'thread-1' });
    const arg = draftsCreate.mock.calls[0][0];
    expect(arg.userId).toBe('me');
    const raw = Buffer.from(
      String(arg.requestBody.message.raw).replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    expect(raw).toContain('To: jane@acme.com');
    expect(raw).toContain('Subject: Hello');
  });

  it('is idempotent when an idempotencyKey is supplied', async () => {
    draftsCreate.mockResolvedValue({
      data: { id: 'draft-1', message: { id: 'msg-1', threadId: 'thread-1' } },
    });
    const { svc } = build();
    const input = {
      to: 'jane@acme.com',
      subject: 'Hello',
      body: 'Hi',
      idempotencyKey: 'outreach:o-1',
    };
    const first = await svc.createDraft('u-1', input);
    const second = await svc.createDraft('u-1', input);
    expect(second).toEqual(first);
    expect(draftsCreate).toHaveBeenCalledTimes(1);
  });

  it('remembers the thread so replies can be linked back', async () => {
    draftsCreate.mockResolvedValue({
      data: { id: 'draft-1', message: { id: 'msg-1', threadId: 'thread-1' } },
    });
    const { svc } = build();
    await svc.createDraft('u-1', {
      to: 'jane@acme.com',
      subject: 'Hello',
      body: 'Hi',
      linkOutreachMessageId: 'o-42',
    });
    await expect(svc.resolveOutreachThread('thread-1')).resolves.toBe('o-42');
  });

  it('passes threadId through for reply threading', async () => {
    draftsCreate.mockResolvedValue({ data: { id: 'd', message: { id: 'm', threadId: 't' } } });
    const { svc } = build();
    await svc.createDraft('u-1', {
      to: 'jane@acme.com',
      subject: 'Re: Hello',
      body: 'ok',
      threadId: 'thread-1',
      inReplyTo: '<orig@acme.com>',
      references: ['<orig@acme.com>'],
    });
    const arg = draftsCreate.mock.calls[0][0];
    expect(arg.requestBody.message.threadId).toBe('thread-1');
    const raw = Buffer.from(
      String(arg.requestBody.message.raw).replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    expect(raw).toContain('In-Reply-To: <orig@acme.com>');
  });
});

describe('GmailOutboundService.sendDraft / sendMessage', () => {
  it('sendDraft calls drafts.send with the draft id', async () => {
    draftsSend.mockResolvedValue({ data: { id: 'msg-9', threadId: 'thread-9' } });
    const { svc } = build();
    const res = await svc.sendDraft('u-1', 'draft-9');
    expect(res).toEqual({ messageId: 'msg-9', threadId: 'thread-9' });
    expect(draftsSend).toHaveBeenCalledWith({ userId: 'me', requestBody: { id: 'draft-9' } });
  });

  it('sendDraft writes a gmail.sent audit event (AGENTS §3)', async () => {
    draftsSend.mockResolvedValue({ data: { id: 'msg-9', threadId: 'thread-9' } });
    const { svc, auditCreate } = build();
    await svc.sendDraft('u-1', 'draft-9', {
      recipient: 'jane@acme.com',
      outreachMessageId: 'o-1',
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0]).toMatchObject({
      data: {
        userId: 'u-1',
        action: 'gmail.sent',
        resourceType: 'gmail_message',
        resourceId: 'msg-9',
        payload: {
          gmailMessageId: 'msg-9',
          threadId: 'thread-9',
          gmailDraftId: 'draft-9',
          recipient: 'jane@acme.com',
          outreachMessageId: 'o-1',
        },
      },
    });
  });

  it('sendMessage posts a MIME message directly', async () => {
    messagesSend.mockResolvedValue({ data: { id: 'msg-10', threadId: 'thread-10' } });
    const { svc } = build();
    const res = await svc.sendMessage('u-1', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(res).toEqual({ messageId: 'msg-10', threadId: 'thread-10' });
    expect(messagesSend).toHaveBeenCalledOnce();
  });

  it('sendMessage writes a gmail.sent audit event (AGENTS §3)', async () => {
    messagesSend.mockResolvedValue({ data: { id: 'msg-10', threadId: 'thread-10' } });
    const { svc, auditCreate } = build();
    await svc.sendMessage('u-1', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0]).toMatchObject({
      data: {
        userId: 'u-1',
        action: 'gmail.sent',
        resourceType: 'gmail_message',
        resourceId: 'msg-10',
        payload: { recipient: 'a@b.com', gmailMessageId: 'msg-10', threadId: 'thread-10' },
      },
    });
  });

  it('sendMessage with an idempotencyKey carries a deterministic Message-ID', async () => {
    messagesSend.mockResolvedValue({ data: { id: 'msg-11', threadId: 'thread-11' } });
    const { svc } = build();
    const input = {
      to: 'a@b.com',
      subject: 's',
      body: 'b',
      idempotencyKey: 'outreach:o-1',
    };
    await svc.sendMessage('u-1', input);
    const raw = decodeRaw(messagesSend.mock.calls[0][0]);
    const firstId = raw.match(/Message-ID: <[^>]+>/)?.[0];
    expect(firstId).toMatch(/^Message-ID: <[0-9a-f]+@careeros\.local>$/);

    // Same stable key => byte-identical Message-ID on a retry.
    messagesSend.mockClear();
    messagesSend.mockResolvedValue({ data: { id: 'msg-11', threadId: 'thread-11' } });
    await svc.sendMessage('u-1', input);
    expect(decodeRaw(messagesSend.mock.calls[0][0]).match(/Message-ID: <[^>]+>/)?.[0]).toBe(firstId);
  });

  it('sendMessage without an idempotencyKey does not retry (no duplicate risk)', async () => {
    const networkErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    messagesSend.mockRejectedValueOnce(networkErr).mockResolvedValueOnce({
      data: { id: 'msg-12', threadId: null },
    });
    const { svc } = build();
    await expect(
      svc.sendMessage('u-1', { to: 'a@b.com', subject: 's', body: 'b' }),
    ).rejects.toBe(networkErr);
    expect(messagesSend).toHaveBeenCalledTimes(1);
  });

  it('sendMessage with an idempotencyKey retries transient failures', async () => {
    const networkErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    messagesSend.mockRejectedValueOnce(networkErr).mockResolvedValueOnce({
      data: { id: 'msg-13', threadId: null },
    });
    const { svc } = build();
    await expect(
      svc.sendMessage('u-1', {
        to: 'a@b.com',
        subject: 's',
        body: 'b',
        idempotencyKey: 'k-1',
      }),
    ).resolves.toEqual({ messageId: 'msg-13', threadId: null });
    expect(messagesSend).toHaveBeenCalledTimes(2);
  });
});
