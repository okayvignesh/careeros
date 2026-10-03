import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuditTable, buildAuditQuery, type AuditRow } from './AuditLog';

describe('buildAuditQuery', () => {
  const base = { actor: '', action: '', resourceType: '', from: '', to: '', offset: 0, limit: 50 };

  it('always carries limit + offset', () => {
    expect(buildAuditQuery(base)).toBe('limit=50&offset=0');
  });

  it('serializes filters and UTC day bounds', () => {
    const qs = buildAuditQuery({
      actor: 'user',
      action: 'approval',
      resourceType: 'approval_item',
      from: '2026-09-01',
      to: '2026-09-30',
      offset: 50,
      limit: 50,
    });
    const params = new URLSearchParams(qs);
    expect(params.get('actor')).toBe('user');
    expect(params.get('action')).toBe('approval');
    expect(params.get('resourceType')).toBe('approval_item');
    // `to` is inclusive of the whole day.
    expect(params.get('from')).toBe('2026-09-01T00:00:00.000Z');
    expect(params.get('to')).toBe('2026-09-30T23:59:59.999Z');
    expect(params.get('offset')).toBe('50');
  });

  it('omits blank filters', () => {
    const qs = buildAuditQuery({ ...base, actor: '', action: '', resourceType: '' });
    expect(qs).not.toContain('actor=');
    expect(qs).not.toContain('action=');
    expect(qs).not.toContain('resourceType=');
  });
});

const rows: AuditRow[] = [
  {
    id: 'r1',
    actor: 'user',
    action: 'approval.approved',
    resourceType: 'approval_item',
    resourceId: '2f19c4aa-0000-0000-0000-000000000000',
    payload: { kind: 'ats_submit', token: '[REDACTED]' },
    ip: '127.0.0.1',
    userAgent: 'vitest',
    timestamp: '2026-09-18T08:02:00.000Z',
  },
  {
    id: 'r2',
    actor: 'system',
    action: 'approval.sent',
    resourceType: null,
    resourceId: null,
    payload: null,
    ip: null,
    userAgent: null,
    timestamp: '2026-09-18T08:03:00.000Z',
  },
];

describe('AuditTable', () => {
  it('renders actor, action, source and a payload detail per row', () => {
    const html = renderToStaticMarkup(createElement(AuditTable, { rows }));
    expect((html.match(/data-testid="audit-row"/g) ?? []).length).toBe(2);
    expect(html).toContain('approval.approved');
    expect(html).toContain('approval.sent');
    expect(html).toContain('user');
    expect(html).toContain('system');
    expect(html).toContain('approval_item');
    expect(html).toContain('2f19c4aa');
    // Server already redacted this; the viewer must not re-expose it.
    expect(html).toContain('[REDACTED]');
    expect(html).toContain('data-testid="audit-payload"');
    // Row without a payload shows a dash instead of an empty <details>.
    expect((html.match(/data-testid="audit-payload"/g) ?? []).length).toBe(1);
  });
});
