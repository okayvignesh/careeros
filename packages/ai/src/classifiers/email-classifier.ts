// E.5 orchestrator: heuristic-first with LLM fallback.
//
// Callers (worker, ingest pipeline, evals) get one function -
// `classifyEmail({from, subject, snippet, provider?})`. Providerless
// callers get heuristic-only classification (returns 'other' at low
// confidence when the heuristic does not fire, so downstream can still
// route the mail without a null check).
//
// When a provider is passed we run the LLM stage on any miss OR any
// heuristic hit below HEURISTIC_TRUST_THRESHOLD, and fuse the two:
//   - agree      -> return the higher confidence
//   - disagree   -> LLM wins (heuristic was uncertain by definition)
//
// The prompt is registered in packages/ai/src/prompts/email-classifier.ts.
// Wrapping of untrusted content is the CALLER's job (via
// wrapUntrusted('email') on the raw HTML) so this file stays pure
// orchestration.

import {
  HEURISTIC_TRUST_THRESHOLD,
  classifyEmailHeuristic,
  truncateSnippetForLlm,
  type EmailClassification,
  type EmailClass,
} from '@careeros/shared';
import type { AIProvider } from '../provider';
import { renderPrompt } from '../prompts';

export interface ClassifyEmailInput {
  from: string;
  subject: string;
  snippet?: string;
  provider?: AIProvider;
}

export interface ClassifyEmailResult extends EmailClassification {
  /** Where the class came from. Useful for audit + eval grading. */
  method: 'heuristic' | 'llm' | 'llm-agreed' | 'fallback';
}

const LOW_CONFIDENCE_FALLBACK: ClassifyEmailResult = {
  class: 'other',
  confidence: 0.3,
  evidence: 'no heuristic hit, no llm provided',
  method: 'fallback',
};

export async function classifyEmail(input: ClassifyEmailInput): Promise<ClassifyEmailResult> {
  const heuristic = classifyEmailHeuristic({
    from: input.from,
    subject: input.subject,
    ...(input.snippet !== undefined ? { snippet: input.snippet } : {}),
  });

  // Fast path: heuristic hit above threshold + no provider to consult.
  // Also fast path when we have no provider at all.
  if (!input.provider) {
    if (heuristic) return { ...heuristic, method: 'heuristic' };
    return LOW_CONFIDENCE_FALLBACK;
  }

  // Heuristic is confident enough on its own; skip the LLM cost.
  if (heuristic && heuristic.confidence >= HEURISTIC_TRUST_THRESHOLD + 0.15) {
    return { ...heuristic, method: 'heuristic' };
  }

  const llm = await runLlm(input.provider, {
    from: input.from,
    subject: input.subject,
    snippet: input.snippet ?? '',
  });

  if (!heuristic) return { ...llm, method: 'llm' };

  if (heuristic.class === llm.class) {
    return {
      class: heuristic.class,
      confidence: Math.max(heuristic.confidence, llm.confidence),
      evidence: heuristic.evidence ?? llm.evidence,
      method: 'llm-agreed',
    };
  }

  // Disagreement. Heuristic was above threshold but LLM said something
  // else. Trust the LLM but preserve the heuristic evidence for audit.
  const merged: ClassifyEmailResult = {
    ...llm,
    method: 'llm',
  };
  if (heuristic.evidence !== undefined) {
    merged.evidence = `llm; heuristic-disagreed:${heuristic.class}(${heuristic.evidence})`;
  }
  return merged;
}

async function runLlm(
  provider: AIProvider,
  input: { from: string; subject: string; snippet: string },
): Promise<EmailClassification> {
  const rendered = renderPrompt('email-classifier', {
    from: input.from,
    subject: input.subject,
    snippet: truncateSnippetForLlm(input.snippet),
  });
  const parsed = await provider.chatStructured({
    messages: [
      { role: 'system', content: rendered.system },
      { role: 'user', content: rendered.user },
    ],
    schema: rendered.schema,
    // Classifier: deterministic. Zero temperature keeps two identical
    // mails from flipping class between two ingest runs.
    temperature: 0,
    maxTokens: 200,
    meta: {
      promptId: rendered.id,
      promptVersion: rendered.version,
      promptHash: rendered.hash,
    },
  });
  return parsed as EmailClassification;
}

/**
 * Exposed for tests: given a heuristic + an LLM result, which wins?
 * Duplicated from the fusion logic above so unit tests can pin it down
 * without spinning up a fake provider.
 */
export function fuseClassifications(
  heuristic: EmailClassification | null,
  llm: EmailClassification,
): ClassifyEmailResult {
  if (!heuristic) return { ...llm, method: 'llm' };
  if (heuristic.class === llm.class) {
    return {
      class: heuristic.class,
      confidence: Math.max(heuristic.confidence, llm.confidence),
      evidence: heuristic.evidence ?? llm.evidence,
      method: 'llm-agreed',
    };
  }
  const merged: ClassifyEmailResult = { ...llm, method: 'llm' };
  if (heuristic.evidence !== undefined) {
    merged.evidence = `llm; heuristic-disagreed:${heuristic.class}(${heuristic.evidence})`;
  }
  return merged;
}

export type { EmailClass, EmailClassification };
