import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { InboxService, IngestResult as InboxIngestResult } from '../inbox/inbox.service';
import {
  EmailIngestService,
  extractApplicationFields,
  type EmailProcessingPayload,
} from './email-ingest.service';

/**
 * E.7 wire: classified recruiter/interview/assessment/rejection mail must
 * reach `InboxService.ingest`, be idempotent on messageId, and never drag the
 * job-alert parsing path down. Gmail fetch is stubbed; the point under test is
 * the orchestration between classification and inbox triage.
 */

const GMAIL_ENV_KEYS = [
  'GMAIL_OAUTH_CLIENT_ID',
  'GMAIL_OAUTH_CLIENT_SECRET',
  'GMAIL_OAUTH_REDIRECT_URI',
  'GMAIL_PUBSUB_TOPIC',
  'GMAIL_PUBSUB_AUDIENCE',
] as const;
const savedEnv = new Map<string, string | undefined>();

beforeAll(() => {
  // readGmailEnv() runs in the constructor; unsetting keeps the BullMQ worker
  // from being created against a live Redis in a unit test.
  for (const key of GMAIL_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of GMAIL_ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function fakePrisma(): PrismaService {
  return {
    auditEvent: { create: vi.fn(async () => ({ id: 'audit-1' })) },
    jobRaw: { createMany: vi.fn(async () => ({ count: 0 })) },
  } as unknown as PrismaService;
}

/** Minimal in-memory InboxService double with the real upsert idempotency. */
function fakeInbox() {
  const items = new Map<string, InboxIngestResult>();
  let counter = 0;
  const ingest = vi.fn(async (input: { userId: string; emailId: string }): Promise<InboxIngestResult> => {
    const key = `${input.userId}::${input.emailId}`;
    const existing = items.get(key);
    if (existing) return existing;
    const result: InboxIngestResult = {
      inboxItemId: `inbox-${++counter}`,
      status: 'new',
      linkedApplicationId: null,
      matchConfidence: null,
      matchMethod: null,
    };
    items.set(key, result);
    return result;
  });
  return { service: { ingest } as unknown as InboxService, ingest, items };
}

function makeService(inbox: InboxService, fetched: Partial<{ from: string; subject: string; html: string }> = {}) {
  const svc = new EmailIngestService(fakePrisma(), inbox);
  (svc as unknown as { fetchMessage: () => Promise<unknown> }).fetchMessage = async () => ({
    from: 'Stripe Recruiting <recruiter@stripe.com>',
    subject: 'Interview for Backend Engineer at Stripe',
    receivedAt: new Date('2026-06-15T08:00:00Z'),
    html: '<p>We would like to schedule an interview for the Backend Engineer role.</p>',
    ...fetched,
  });
  return svc;
}

const PAYLOAD: EmailProcessingPayload = { userId: 'u-1', messageId: 'gmail-msg-1', threadId: null };

describe('EmailIngestService inbox triage wire', () => {
  it('ingests interview mail into the inbox with extracted company + role', async () => {
    const { service, ingest } = fakeInbox();
    const svc = makeService(service);

    const result = await svc.processJob(PAYLOAD, {} as never);

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]![0]).toMatchObject({
      userId: 'u-1',
      emailId: 'gmail-msg-1',
      emailClass: 'interview_invite',
      parsed: { company: 'Stripe', role: 'Backend Engineer' },
    });
    // stripe.com is not a job-alert sender, so parsing is dropped but triage survives.
    expect(result.status).toBe('dropped-sender');
    expect(result.inbox?.itemId).toBe('inbox-1');
  });

  it('is idempotent: the same messageId reuses one inbox item', async () => {
    const { service, items } = fakeInbox();
    const svc = makeService(service);

    const first = await svc.processJob(PAYLOAD, {} as never);
    const second = await svc.processJob(PAYLOAD, {} as never);

    expect(items.size).toBe(1);
    expect(first.inbox?.itemId).toBe(second.inbox?.itemId);
    // MUTATION-SMOKE: key the inbox item on something unstable (e.g. a fresh
    // uuid per call) and items.size becomes 2.
  });

  it('does not triage job-alert digests', async () => {
    const { service, ingest } = fakeInbox();
    const svc = makeService(service, { from: 'LinkedIn <jobs-noreply@linkedin.com>', subject: 'New jobs for you' });

    const result = await svc.processJob(PAYLOAD, {} as never);

    expect(ingest).not.toHaveBeenCalled();
    expect(result.inbox).toBeUndefined();
  });

  it('does not triage unclassified mail', async () => {
    const { service, ingest } = fakeInbox();
    const svc = makeService(service, { from: 'friend@example.com', subject: 'Lunch tomorrow?' });

    await svc.processJob(PAYLOAD, {} as never);

    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('extractApplicationFields', () => {
  it('pulls role + company from the "for X at Y" subject shape', () => {
    expect(extractApplicationFields('recruiter@stripe.com', 'Interview for Backend Engineer at Stripe')).toEqual({
      company: 'Stripe',
      role: 'Backend Engineer',
    });
  });

  it('handles the "position at" variant and trims punctuation', () => {
    expect(
      extractApplicationFields('jobs@acme.io', 'Application for the Senior Platform position at Acme, Inc.'),
    ).toEqual({ company: 'Acme, Inc', role: 'Senior Platform' });
  });

  it('returns nulls when the subject does not name both fields', () => {
    expect(extractApplicationFields('recruiter@stripe.com', 'Following up on your application')).toEqual({
      company: null,
      role: null,
    });
  });
});
