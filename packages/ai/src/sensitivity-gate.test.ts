import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  allowedProviders,
  assertProviderAllowed,
  classifySensitivity,
  decideProviderEgress,
  isProviderAllowed,
  setSensitivityAuditHook,
  type ProviderPolicy,
  type SensitivityAuditEvent,
} from './sensitivity-gate';
import { SensitivityBlockedError } from './errors';

// A6 regression suite: pure, policy-free sensitivity primitives. Each test
// carries a one-line mutation-smoke note: remove the guard the test names, all
// assertions in the block fail.

describe('classifySensitivity', () => {
  it('classifies a bearer token as employer-confidential (top label)', () => {
    // mutation smoke: strip the /Bearer/ regex → this test fails first.
    expect(classifySensitivity('Authorization: Bearer abc123def456ghi789jkl012')).toBe(
      'employer-confidential',
    );
  });

  it('classifies a private-key block as employer-confidential', () => {
    // mutation smoke: drop PRIVATE KEY regex → test drops to public.
    expect(classifySensitivity('-----BEGIN RSA PRIVATE KEY-----\nMIIB...')).toBe(
      'employer-confidential',
    );
  });

  it('classifies a phone number as personal', () => {
    // mutation smoke: remove PRIVATE_PATTERNS phone rx → returns public.
    expect(classifySensitivity('call me at (415) 555-2671 today')).toBe('personal');
  });

  it('classifies an email address as personal', () => {
    // mutation smoke: remove email regex → returns public.
    expect(classifySensitivity('please reach out to jane@example.com')).toBe('personal');
  });

  it('classifies generic text as public', () => {
    // mutation smoke: default fallback changed → this test flips.
    expect(classifySensitivity('React 18 introduced concurrent rendering.')).toBe('public');
  });

  it('respects source hint for employer-confidential', () => {
    // mutation smoke: drop the source-hint check → falls to public.
    expect(classifySensitivity('function add(a,b){return a+b;}', { source: 'private-repo' })).toBe(
      'employer-confidential',
    );
  });

  it('secret detection beats employer-confidential source hint', () => {
    // mutation smoke: run source-hint before SECRET_PATTERNS → returns
    // 'employer-confidential' from the hint path instead of the secret path.
    expect(
      classifySensitivity('const cfg = { key: "sk-live_abcdefghijklmnop_qrst" };', {
        source: 'private-repo',
      }),
    ).toBe('employer-confidential');
  });
});

describe('decideProviderEgress / assertProviderAllowed (passed-in policy)', () => {
  const policy: ProviderPolicy = {
    deepseek: 'personal',
    openai: 'personal',
    ollama: 'confidential',
    local: 'confidential',
    // Explicit opt-in: only this provider may see employer-confidential data.
    'local-trusted': 'employer-confidential',
    killswitch: 'block',
    confined: 'local-only',
    unknownish: 'personal',
  };

  it('personal ceiling allows public + personal, blocks confidential+', () => {
    expect(isProviderAllowed('deepseek', 'public', policy)).toBe(true);
    expect(isProviderAllowed('deepseek', 'personal', policy)).toBe(true);
    expect(isProviderAllowed('deepseek', 'confidential', policy)).toBe(false);
    expect(isProviderAllowed('deepseek', 'employer-confidential', policy)).toBe(false);
  });

  it('local-only provider is never allowed by the policy primitive', () => {
    const d = decideProviderEgress('confined', 'public', policy);
    expect(d).toEqual({ allowed: false, ceiling: 'local-only', reason: 'not-permitted' });
  });

  it('block ceiling and unknown providers fail closed', () => {
    expect(decideProviderEgress('killswitch', 'public', policy).allowed).toBe(false);
    expect(decideProviderEgress('never-heard-of-it', 'public', policy)).toEqual({
      allowed: false,
      ceiling: 'block',
      reason: 'not-permitted',
    });
  });

  it('assertProviderAllowed throws SensitivityBlockedError with provider context', () => {
    let threw: unknown = null;
    try {
      assertProviderAllowed('deepseek', 'employer-confidential', policy);
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(SensitivityBlockedError);
    expect((threw as SensitivityBlockedError).level).toBe('employer-confidential');
    expect((threw as SensitivityBlockedError).context).toBe('deepseek');
  });

  it('mixed-sensitivity payload blocks the correct provider', () => {
    // A payload containing employer-confidential code may route only to the
    // provider explicitly pinned to that ceiling — never to external
    // personal-ceiling providers, and not even to the confidential local ones.
    expect(allowedProviders('employer-confidential', policy)).toEqual(['local-trusted']);
    expect(allowedProviders('public', policy)).toEqual([
      'deepseek',
      'openai',
      'ollama',
      'local',
      'local-trusted',
      'unknownish',
    ]);
    expect(() => assertProviderAllowed('deepseek', 'employer-confidential', policy)).toThrow(
      SensitivityBlockedError,
    );
    expect(() => assertProviderAllowed('local', 'employer-confidential', policy)).toThrow(
      SensitivityBlockedError,
    );
    expect(() =>
      assertProviderAllowed('local-trusted', 'employer-confidential', policy),
    ).not.toThrow();
    expect(() => assertProviderAllowed('deepseek', 'public', policy)).not.toThrow();
  });
});

describe('sensitivity audit hook', () => {
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
    classifySensitivity('call me at (415) 555-2671', { source: 'user-input' });
    expect(events.length).toBe(1);
    expect(events[0]!.code).toBe('security.audit.sensitivity_classified');
    expect(events[0]!.level).toBe('personal');
  });

  it('audit throw is swallowed (never breaks the caller)', () => {
    // mutation smoke: remove try/catch around auditHook → this throws.
    setSensitivityAuditHook(() => {
      throw new Error('audit crash');
    });
    expect(() => classifySensitivity('hello')).not.toThrow();
  });
});
