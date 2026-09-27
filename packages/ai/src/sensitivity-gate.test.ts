import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SensitivityGate,
  SensitivityBlockedError,
  setSensitivityAuditHook,
  type SensitivityAuditEvent,
} from './sensitivity-gate';

// C-P0.3a regression suite. Each test carries a one-line mutation-smoke note:
// remove the guard the test names, all assertions in the block fail.

describe('SensitivityGate.classify', () => {
  const gate = new SensitivityGate();

  it('classifies a bearer token as system-secret', () => {
    // mutation smoke: strip the /Bearer/ regex → this test fails first.
    const level = gate.classify('Authorization: Bearer abc123def456ghi789jkl012');
    expect(level).toBe('system-secret');
  });

  it('classifies a private-key block as system-secret', () => {
    // mutation smoke: drop PRIVATE KEY regex → test drops to public.
    const level = gate.classify('-----BEGIN RSA PRIVATE KEY-----\nMIIB...');
    expect(level).toBe('system-secret');
  });

  it('classifies a phone number as private', () => {
    // mutation smoke: remove PRIVATE_PATTERNS phone rx → returns public.
    const level = gate.classify('call me at (415) 555-2671 today');
    expect(level).toBe('private');
  });

  it('classifies an email address as private', () => {
    // mutation smoke: remove email regex → returns public.
    const level = gate.classify('please reach out to jane@example.com');
    expect(level).toBe('private');
  });

  it('classifies generic text as public', () => {
    // mutation smoke: default fallback changed → this test flips.
    const level = gate.classify('React 18 introduced concurrent rendering.');
    expect(level).toBe('public');
  });

  it('respects source hint for employer-confidential', () => {
    // mutation smoke: drop the source-hint check → falls to public.
    const level = gate.classify('function add(a,b){return a+b;}', { source: 'private-repo' });
    expect(level).toBe('employer-confidential');
  });

  it('secret detection beats employer-confidential source hint', () => {
    // mutation smoke: run source-hint before SECRET_PATTERNS → returns
    // 'employer-confidential' instead of 'system-secret'.
    const level = gate.classify(
      'const cfg = { key: "sk-live_abcdefghijklmnop_qrst" };',
      { source: 'private-repo' },
    );
    expect(level).toBe('system-secret');
  });
});

describe('SensitivityGate.assertAllowed', () => {
  const gate = new SensitivityGate();

  it('throws SensitivityBlockedError when system-secret routes to llm-external', () => {
    // mutation smoke: raise CONTEXT_CEILING['llm-external'] → no throw.
    let threw: unknown = null;
    try {
      gate.assertAllowed('system-secret', 'llm-external');
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(SensitivityBlockedError);
    expect((threw as SensitivityBlockedError).level).toBe('system-secret');
    expect((threw as SensitivityBlockedError).context).toBe('llm-external');
  });

  it('allows private content in llm-local', () => {
    // mutation smoke: drop llm-local ceiling to public → throws.
    expect(() => gate.assertAllowed('private', 'llm-local')).not.toThrow();
  });

  it('throws when employer-confidential routes to browser-agent', () => {
    // mutation smoke: raise browser-agent ceiling → allowed.
    expect(() => gate.assertAllowed('employer-confidential', 'browser-agent')).toThrow(
      SensitivityBlockedError,
    );
  });

  it('allows public content in every context', () => {
    // mutation smoke: any context ceiling < 0 → this test flips.
    for (const ctx of [
      'llm-external',
      'llm-local',
      'log',
      'browser-agent',
      'outbound-email',
    ] as const) {
      expect(() => gate.assertAllowed('public', ctx)).not.toThrow();
    }
  });
});

describe('SensitivityGate re-auth window', () => {
  let gate: SensitivityGate;

  beforeEach(() => {
    gate = new SensitivityGate();
  });

  it('fresh re-auth passes hasFreshReauth', () => {
    // mutation smoke: withReauthWindow no-ops → test fails.
    gate.withReauthWindow('user-1', 'send-secret', 60_000);
    expect(gate.hasFreshReauth('user-1', 'send-secret')).toBe(true);
  });

  it('stale re-auth (past window) fails hasFreshReauth', () => {
    // mutation smoke: hasFreshReauth ignores expiry → test flips true.
    gate.withReauthWindow('user-1', 'send-secret', 1); // 1ms window
    // Busy-wait past the deadline so we do not need fake timers.
    const deadline = Date.now() + 3;
    while (Date.now() < deadline) {
      /* spin */
    }
    expect(gate.hasFreshReauth('user-1', 'send-secret')).toBe(false);
  });

  it('re-auth window is scoped per userId per opTag', () => {
    // mutation smoke: key collapses to userId only → user-2 inherits truth.
    gate.withReauthWindow('user-1', 'send-secret', 60_000);
    expect(gate.hasFreshReauth('user-1', 'send-secret')).toBe(true);
    expect(gate.hasFreshReauth('user-2', 'send-secret')).toBe(false);
    expect(gate.hasFreshReauth('user-1', 'different-op')).toBe(false);
  });

  it('defaults to a 5-minute window per plan/ai-safety.md item 8', () => {
    // mutation smoke: default drops to 0 → hasFreshReauth false immediately.
    const before = Date.now();
    const handle = gate.withReauthWindow('user-1', 'send-secret');
    expect(handle.expiresAt).toBeGreaterThanOrEqual(before + 300_000 - 50);
    expect(handle.expiresAt).toBeLessThanOrEqual(before + 300_000 + 50);
    expect(gate.hasFreshReauth('user-1', 'send-secret')).toBe(true);
  });
});

describe('SensitivityGate audit hook', () => {
  const events: SensitivityAuditEvent[] = [];

  beforeEach(() => {
    events.length = 0;
    setSensitivityAuditHook((evt) => events.push(evt));
  });

  afterEach(() => {
    setSensitivityAuditHook(null);
  });

  it('emits a classified event with the returned level', () => {
    // mutation smoke: remove audit() call inside classify → events stays empty.
    const gate = new SensitivityGate();
    gate.classify('call me at (415) 555-2671', { source: 'user-input' });
    expect(events.length).toBe(1);
    expect(events[0]!.code).toBe('security.audit.sensitivity_classified');
    expect(events[0]!.level).toBe('private');
  });

  it('emits a blocked event before throwing SensitivityBlockedError', () => {
    // mutation smoke: audit() moved after throw → events stays empty.
    const gate = new SensitivityGate();
    expect(() => gate.assertAllowed('system-secret', 'llm-external')).toThrow(
      SensitivityBlockedError,
    );
    expect(events.length).toBe(1);
    expect(events[0]!.code).toBe('security.audit.sensitivity_blocked');
    expect(events[0]!.context).toBe('llm-external');
  });

  it('audit throw is swallowed (never breaks the caller)', () => {
    // mutation smoke: remove try/catch around auditHook → this throws.
    setSensitivityAuditHook(() => {
      throw new Error('audit crash');
    });
    const gate = new SensitivityGate();
    expect(() => gate.classify('hello')).not.toThrow();
  });
});
