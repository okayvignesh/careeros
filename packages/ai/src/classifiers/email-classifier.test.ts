import { describe, expect, it, vi } from 'vitest';
import type { EmailClassification } from '@careeros/shared';
import type { AIProvider } from '../provider';
import '../prompts';
import { classifyEmail, fuseClassifications } from './email-classifier';

/**
 * E.5 orchestrator tests. Focus is the routing logic (which path fires,
 * how fusion works when heuristic + LLM disagree). Prompt content itself
 * is validated by packages/shared/src/email-classifier.test.ts and by the
 * eval fixtures in ../evals/email-classifier.
 */

function fakeProvider(response: EmailClassification): AIProvider {
  return {
    id: 'fake',
    capabilities: { chat: true, json: true, streaming: false },
    async chat() {
      throw new Error('chat unused');
    },
    async chatStructured() {
      return response as unknown;
    },
    async probe() {
      return { ok: true, capabilities: { chat: true, json: true, streaming: false } };
    },
  } as unknown as AIProvider;
}

describe('classifyEmail - heuristic-only path (no provider)', () => {
  it('returns heuristic hit as method:heuristic', async () => {
    const out = await classifyEmail({
      from: 'alert@indeed.com',
      subject: 'New jobs for you',
    });
    expect(out.class).toBe('job_alert_indeed');
    expect(out.method).toBe('heuristic');
    expect(out.confidence).toBeGreaterThan(0.9);
  });

  it('returns fallback other/0.3 when heuristic misses', async () => {
    const out = await classifyEmail({
      from: 'friend@personal.com',
      subject: 'lunch tomorrow',
    });
    expect(out.class).toBe('other');
    expect(out.method).toBe('fallback');
    expect(out.confidence).toBeLessThanOrEqual(0.5);
  });
});

describe('classifyEmail - LLM fallback (provider given)', () => {
  it('skips LLM when heuristic is well above threshold', async () => {
    const provider = fakeProvider({ class: 'other', confidence: 0.99 });
    const spy = vi.spyOn(provider, 'chatStructured');
    const out = await classifyEmail({
      from: 'alert@indeed.com',
      subject: 'New jobs for you',
      provider,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(out.method).toBe('heuristic');
    expect(out.class).toBe('job_alert_indeed');
    // MUTATION-SMOKE: raise the skip threshold and this fires the LLM even
    // on the indeed hit, breaking the assertion.
  });

  it('runs LLM when heuristic misses; returns method:llm', async () => {
    const provider = fakeProvider({
      class: 'recruiter',
      confidence: 0.82,
      evidence: 'greeting + role reference',
    });
    const out = await classifyEmail({
      from: 'random@example.com',
      subject: 'Hey there',
      snippet: 'Saw your profile, wondering if you would be open to a chat about an engineering role.',
      provider,
    });
    expect(out.method).toBe('llm');
    expect(out.class).toBe('recruiter');
  });

  it('LLM wins when it disagrees with a threshold-only heuristic hit', async () => {
    // Sender-hint path fires with confidence 0.76 (right at threshold).
    // LLM says the actual mail is a rejection. LLM should win.
    const provider = fakeProvider({
      class: 'rejection',
      confidence: 0.94,
      evidence: 'unfortunately... move forward',
    });
    const out = await classifyEmail({
      from: 'sarah@lever.co',
      subject: 'Thanks for applying',
      snippet: 'Unfortunately we have decided not to move forward at this time.',
      provider,
    });
    expect(out.method).toBe('llm');
    expect(out.class).toBe('rejection');
    // Preserves the disagreement in the evidence field for audit.
    expect(out.evidence).toMatch(/heuristic-disagreed:recruiter/);
  });
});

describe('fuseClassifications', () => {
  it('agree -> takes higher confidence', () => {
    const out = fuseClassifications(
      { class: 'offer', confidence: 0.8 },
      { class: 'offer', confidence: 0.95 },
    );
    expect(out.class).toBe('offer');
    expect(out.confidence).toBe(0.95);
    expect(out.method).toBe('llm-agreed');
  });

  it('disagree -> LLM wins with a diagnostic evidence string', () => {
    const out = fuseClassifications(
      { class: 'recruiter', confidence: 0.76, evidence: 'sender_hint' },
      { class: 'rejection', confidence: 0.9, evidence: 'unfortunately' },
    );
    expect(out.class).toBe('rejection');
    expect(out.method).toBe('llm');
    expect(out.evidence).toContain('heuristic-disagreed:recruiter');
  });
});
