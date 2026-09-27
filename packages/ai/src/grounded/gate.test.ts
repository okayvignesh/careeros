// C-P4.7a: unit tests for the shared fact-check gate.
//
// Covers: happy path (verdicts round-trip by index), auditor failure
// (returns `{ ok: false }` never throws), empty input short-circuit, and
// the prompt-body renderer (indexed, cited, one call to the LLM).
import { describe, expect, it, vi } from 'vitest';
import type { FactCheckResult } from '@careeros/shared';
import { renderClaimsForPrompt, runFactCheck, type Claim } from './gate';

const FACTS = [
  { id: 'f-1', kind: 'employment', summary: 'SRE Lead @Acme 2022-2024' },
  { id: 'f-2', kind: 'education', summary: 'BSc CS' },
];

const CLAIMS: Claim[] = [
  { index: 0, text: 'Ran the Postgres migration.', cited: [FACTS[0]] },
  { index: 1, text: 'Studied CS.', cited: [FACTS[1]] },
];

function stubProvider(script: unknown): {
  chatStructured: (args: unknown) => Promise<unknown>;
} {
  return {
    chatStructured: async (): Promise<unknown> => {
      if (script instanceof Error) throw script;
      return script;
    },
  };
}

describe('renderClaimsForPrompt', () => {
  it('emits one [index] block per claim with cited facts inline', () => {
    const rendered = renderClaimsForPrompt(CLAIMS);
    expect(rendered).toContain('[0] Ran the Postgres migration.');
    expect(rendered).toContain('id=f-1 kind=employment SRE Lead @Acme 2022-2024');
    expect(rendered).toContain('[1] Studied CS.');
    expect(rendered).toContain('id=f-2 kind=education BSc CS');
  });

  it('handles a claim with zero cited facts (renderer stays honest, gate is what drops)', () => {
    const rendered = renderClaimsForPrompt([{ index: 3, text: 'Bare claim.', cited: [] }]);
    expect(rendered).toContain('[3] Bare claim.');
    expect(rendered).toContain('cites:');
  });
});

describe('runFactCheck', () => {
  it('happy path: turns FactCheckResult into a Map keyed by bulletIndex', async () => {
    const script: FactCheckResult = {
      results: [
        { bulletIndex: 0, supported: true, reason: 'matches employment fact' },
        { bulletIndex: 1, supported: false, reason: 'not in facts' },
      ],
    };
    const outcome = await runFactCheck({ provider: stubProvider(script), claims: CLAIMS });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verdicts.get(0)).toEqual({ supported: true, reason: 'matches employment fact' });
    expect(outcome.verdicts.get(1)).toEqual({ supported: false, reason: 'not in facts' });
  });

  it('empty claims: skips the LLM entirely, returns an empty verdict map', async () => {
    const chatStructured = vi.fn();
    const outcome = await runFactCheck({
      provider: { chatStructured: chatStructured as never },
      claims: [],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.verdicts.size).toBe(0);
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('auditor throws → returns { ok: false, reason }, never rethrows', async () => {
    const outcome = await runFactCheck({
      provider: stubProvider(new Error('deepseek 500')),
      claims: CLAIMS,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('deepseek 500');
  });

  it('routes the LLM call through runWithUserLimit when supplied (A-M9 shape preserved)', async () => {
    const wrap = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const script: FactCheckResult = { results: [{ bulletIndex: 0, supported: true, reason: 'ok' }] };
    await runFactCheck({
      provider: stubProvider(script),
      claims: [CLAIMS[0]],
      runWithUserLimit: wrap,
    });
    expect(wrap).toHaveBeenCalledOnce();
  });

  it('missing verdict for an index leaves the Map entry absent (caller drops)', async () => {
    const script: FactCheckResult = {
      // Only bullet 0 scored. Bullet 1 must be Map-absent so the caller's
      // "no verdict = drop" default fires.
      results: [{ bulletIndex: 0, supported: true, reason: 'ok' }],
    };
    const outcome = await runFactCheck({ provider: stubProvider(script), claims: CLAIMS });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verdicts.has(0)).toBe(true);
    expect(outcome.verdicts.has(1)).toBe(false);
  });
});
