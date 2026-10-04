import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeOutreach,
  discardOutreach,
  listPendingApprovals,
  pendingOutreachApprovalIds,
  requestOutreachApproval,
  sendOutreach,
} from './outreach';

describe('pendingOutreachApprovalIds', () => {
  it('maps only outreach_email items to their message id', () => {
    const map = pendingOutreachApprovalIds([
      { id: 'a1', kind: 'outreach_email', state: 'pending', payload: { outreachMessageId: 'm1' } },
      { id: 'a2', kind: 'ats_submit', state: 'pending', payload: { outreachMessageId: 'm2' } },
      { id: 'a3', kind: 'outreach_email', state: 'pending', payload: null },
    ]);
    expect([...map.entries()]).toEqual([['m1', 'a1']]);
  });
});

describe('outreach api-client calls', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(
      async () =>
        new Response(status === 204 ? null : JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('composes with POST /outreach', async () => {
    const fetchMock = stubFetch({ ok: true, outreachMessageId: 'm1' });
    await composeOutreach({ templateId: 'cold-reach', recipient: { email: 'a@b.co' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/outreach')).toBe(true);
    expect(init.method).toBe('POST');
  });

  it('enqueues approval with POST /outreach/:id/approve', async () => {
    const fetchMock = stubFetch({ id: 'a1' });
    await requestOutreachApproval('m1');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/outreach/m1/approve')).toBe(true);
  });

  it('sends with POST /outreach/:id/send', async () => {
    const fetchMock = stubFetch({ ok: true });
    await sendOutreach('m1');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/outreach/m1/send')).toBe(true);
  });

  it('discards with POST /outreach/:id/discard', async () => {
    const fetchMock = stubFetch({ ok: true });
    await discardOutreach('m1');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/outreach/m1/discard')).toBe(true);
  });

  it('lists pending approvals for the queue badge', async () => {
    const fetchMock = stubFetch({ items: [] });
    await listPendingApprovals();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.includes('/me/approvals?state=pending')).toBe(true);
  });
});
