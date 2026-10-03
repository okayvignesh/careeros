import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovalCard, approvalKindLabel, needsFreshReauth, type ApprovalItem } from './ApprovalQueue';

const noop = () => {};

const baseItem: ApprovalItem = {
  id: 'a1',
  userId: 'u1',
  kind: 'delete_account',
  payload: { target: 'me' },
  diffJson: {},
  state: 'pending',
  createdAt: '2026-09-20T07:41:00.000Z',
  decidedAt: null,
  sentAt: null,
  failedReason: null,
};

function renderCard(item: ApprovalItem, confirming = false) {
  return renderToStaticMarkup(
    createElement(ApprovalCard, {
      item,
      busy: false,
      confirming,
      rejectReason: '',
      onAskConfirm: noop,
      onCancelConfirm: noop,
      onRejectReason: noop,
      onApprove: noop,
      onReject: noop,
    }),
  );
}

describe('needsFreshReauth', () => {
  it('recognises the approvals gate 403 wording', () => {
    expect(needsFreshReauth('Fresh re-authentication required')).toBe(true);
    expect(needsFreshReauth('fresh reauth required for bulk approval')).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(needsFreshReauth('Illegal approval transition: sent -> approved')).toBe(false);
    expect(needsFreshReauth('POST /me/approvals/a1/approve → 500')).toBe(false);
  });
});

describe('approvalKindLabel', () => {
  it('maps known kinds and falls back to the raw kind', () => {
    expect(approvalKindLabel('ats_submit')).toBe('Submit application');
    expect(approvalKindLabel('custom_kind')).toBe('custom_kind');
  });
});

describe('ApprovalCard', () => {
  it('flags an irreversible item and offers approve/reject without confirming', () => {
    const html = renderCard(baseItem);
    expect(html).toContain('data-testid="approval-item"');
    expect(html).toContain('data-testid="approval-irreversible"');
    expect(html).toContain('data-testid="approval-approve"');
    expect(html).toContain('data-testid="approval-reject"');
    expect(html).not.toContain('data-testid="approval-confirm-approve"');
    // Payload detail is available before approving.
    expect(html).toContain('data-testid="approval-payload"');
    expect(html).toContain('What approving this does');
  });

  it('swaps in a deliberate confirm step', () => {
    const html = renderCard(baseItem, true);
    expect(html).toContain('data-testid="approval-confirm-approve"');
    expect(html).toContain('data-testid="approval-confirm-reject"');
    expect(html).not.toContain('data-testid="approval-approve"');
    expect(html).toContain('cannot be recalled');
  });

  it('shows a failed item with its reason and no action controls', () => {
    const html = renderCard({ ...baseItem, state: 'failed', failedReason: 'no worker registered' });
    expect(html).toContain('failed');
    expect(html).toContain('data-testid="approval-failed-reason"');
    expect(html).toContain('no worker registered');
    expect(html).not.toContain('data-testid="approval-approve"');
  });
});
