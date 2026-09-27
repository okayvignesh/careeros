// E.4b: pure-helper coverage for the gmail service. The heavy pieces
// (googleapis client + Prisma) are exercised in integration; here we pin the
// two shapes that carry the actual business logic:
//
//   * decodePubSubMessage : accepts Google's base64 JSON envelope, rejects
//                           anything malformed.
//   * extractNewMessages  : given a `history.list` response + the set of
//                           messageIds we've already processed, returns only
//                           the genuinely-new ones. This is the idempotency
//                           spine that keeps "same messageId processed twice"
//                           a no-op at the app level (the DB unique index is
//                           the second safety net).
import { describe, expect, it } from 'vitest';
import {
  decodePubSubMessage,
  extractNewMessages,
  type HistoryListResponse,
  type PubSubEnvelope,
} from './gmail.service';

describe('decodePubSubMessage', () => {
  it('decodes the base64 JSON payload Google sends', () => {
    const payload = { emailAddress: 'alice@example.com', historyId: '12345' };
    const env: PubSubEnvelope = {
      message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') },
    };
    expect(decodePubSubMessage(env)).toEqual(payload);
  });

  it('coerces numeric historyId into a string', () => {
    const env: PubSubEnvelope = {
      message: {
        data: Buffer.from(
          JSON.stringify({ emailAddress: 'a@b.co', historyId: 9999999999999 }),
        ).toString('base64'),
      },
    };
    expect(decodePubSubMessage(env).historyId).toBe('9999999999999');
  });

  it('rejects when message.data is absent', () => {
    expect(() => decodePubSubMessage({ message: {} })).toThrow(/pubsub message.data missing/);
  });

  it('rejects when the decoded payload lacks required fields', () => {
    const env: PubSubEnvelope = {
      message: { data: Buffer.from(JSON.stringify({ emailAddress: 'x' })).toString('base64') },
    };
    expect(() => decodePubSubMessage(env)).toThrow(/missing emailAddress or historyId/);
  });
});

describe('extractNewMessages', () => {
  const historyWithTwo: HistoryListResponse = {
    history: [
      {
        id: '100',
        messagesAdded: [
          { message: { id: 'm1', threadId: 't1', internalDate: '1700000000000' } },
        ],
      },
      {
        id: '101',
        messagesAdded: [
          { message: { id: 'm2', threadId: 't2', internalDate: '1700000060000' } },
        ],
      },
    ],
  };

  it('extracts new messageIds from a history.list response', () => {
    const out = extractNewMessages(historyWithTwo, new Set());
    expect(out.map((m) => m.messageId)).toEqual(['m1', 'm2']);
    expect(out[0]).toMatchObject({ threadId: 't1', internalDate: 1700000000000 });
  });

  it('is idempotent: messageIds already in `alreadySeen` are excluded (second push -> no-op)', () => {
    const seen = new Set(['m1', 'm2']);
    const out = extractNewMessages(historyWithTwo, seen);
    expect(out).toEqual([]);
  });

  it('dedupes within a single response (same messageId in two history entries)', () => {
    const dup: HistoryListResponse = {
      history: [
        { id: 'a', messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] },
        { id: 'b', messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] },
      ],
    };
    const out = extractNewMessages(dup, new Set());
    expect(out.map((m) => m.messageId)).toEqual(['m1']);
  });

  it('handles empty / missing history.list result gracefully', () => {
    expect(extractNewMessages({}, new Set())).toEqual([]);
    expect(extractNewMessages({ history: [] }, new Set())).toEqual([]);
    expect(extractNewMessages({ history: [{ id: '1' }] }, new Set())).toEqual([]);
  });

  it('skips messagesAdded entries that lack a message.id', () => {
    const resp: HistoryListResponse = {
      history: [
        {
          id: '1',
          messagesAdded: [
            { message: { threadId: 'tX' } },
            { message: { id: 'm-ok', threadId: 'tX' } },
          ],
        },
      ],
    };
    const out = extractNewMessages(resp, new Set());
    expect(out.map((m) => m.messageId)).toEqual(['m-ok']);
  });
});
