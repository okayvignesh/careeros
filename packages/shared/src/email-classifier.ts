// E.5 (Wave E / P5): email classification.
//
// Classifies an inbound email into one of 9 classes. Two-stage design:
//   Stage 1 - `classifyEmailHeuristic`: regex on sender + subject. Fast,
//             high precision on known senders (LinkedIn/Indeed/Naukri
//             alerts) and unambiguous subject cues (rejection wording,
//             interview scheduling verbs). Returns null when confidence
//             would be < 0.75 so the caller can fall through to the LLM.
//   Stage 2 - LLM classifier lives in packages/ai/src/classifiers/email-
//             classifier.ts. Wraps the body via `wrapUntrusted('email')`,
//             calls the prompt registered in packages/ai/src/prompts/
//             email-classifier.ts, validates against
//             `EmailClassificationSchema`.
//
// The heuristic here is pure (no I/O, no deps beyond zod) so it can run
// inside the ingest worker without a provider config, be replayed in
// tests, and be exported to fixtures.
//
// ponytail: one file, one source of class truth (`EMAIL_CLASSES`). Adding
// a new class means one const + one regex block + fixtures - no framework
// glue.

import { z } from 'zod';

export const EMAIL_CLASSES = [
  'recruiter',
  'interview_invite',
  'assessment',
  'rejection',
  'offer',
  'job_alert_linkedin',
  'job_alert_indeed',
  'job_alert_naukri',
  'other',
] as const;

export type EmailClass = (typeof EMAIL_CLASSES)[number];

export const EmailClassSchema = z.enum(EMAIL_CLASSES);

export const EmailClassificationSchema = z.object({
  class: EmailClassSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(240).optional(),
});

export type EmailClassification = z.infer<typeof EmailClassificationSchema>;

export interface HeuristicInput {
  from: string;
  subject: string;
  snippet?: string;
}

// Sender allowlist for the three job-alert vendors. Kept in sync with
// packages/email-parsers/senders. Matches display-name + angle-bracket
// address form ("LinkedIn <jobs-noreply@linkedin.com>").
const JOB_ALERT_SENDERS: Array<{ pattern: RegExp; cls: EmailClass }> = [
  { pattern: /jobs-noreply@linkedin\.com/i, cls: 'job_alert_linkedin' },
  { pattern: /jobalerts-noreply@linkedin\.com/i, cls: 'job_alert_linkedin' },
  { pattern: /@indeed\.com/i, cls: 'job_alert_indeed' },
  { pattern: /alert@indeed\.com/i, cls: 'job_alert_indeed' },
  { pattern: /mailer@naukri\.com/i, cls: 'job_alert_naukri' },
  { pattern: /jobalerts@naukri\.com/i, cls: 'job_alert_naukri' },
];

// Subject-only signals with strong precision. Regexes are intentionally
// tight; a match implies confidence >= 0.9 because the semantics are
// unambiguous ("You have received an offer" is not going to be spam).
//
// Order matters: earlier rules win. Rejection is placed above offer so
// "unfortunately we cannot offer" reads as rejection, not offer.
const SUBJECT_RULES: Array<{ pattern: RegExp; cls: EmailClass; confidence: number }> = [
  {
    pattern: /\b(unfortunately|not moving forward|will not be proceeding|decided not to|we regret)\b/i,
    cls: 'rejection',
    confidence: 0.92,
  },
  {
    pattern: /\b(you are receiving an offer|offer of employment|offer letter|congratulations.*offer|pleased to offer)\b/i,
    cls: 'offer',
    confidence: 0.93,
  },
  {
    pattern: /\b(interview|schedule.*call|set up (a )?time|invite you to (an )?interview|next round|hr round|technical round)\b/i,
    cls: 'interview_invite',
    confidence: 0.88,
  },
  {
    pattern: /\b(assessment|coding test|take[- ]home|online test|hackerrank|codesignal|leetcode|karat)\b/i,
    cls: 'assessment',
    confidence: 0.88,
  },
  {
    pattern: /\b(opportunity|role|position|reached out|would love to chat|exciting opening|open (role|position)|available (role|position))\b/i,
    cls: 'recruiter',
    confidence: 0.78,
  },
];

// Sender-domain hints for recruiter mail. Matched only if the subject
// rules did NOT hit; keeps precision high (a rejection from a known
// recruiter domain is still a rejection).
const RECRUITER_SENDER_HINTS = [
  /@lever\.co$/i,
  /@greenhouse\.io$/i,
  /@myworkday\.com$/i,
  /@ashbyhq\.com$/i,
  /@smartrecruiters\.com$/i,
  /@icims\.com$/i,
  /@jobvite\.com$/i,
  /talent-acquisition/i,
  /recruit(er|ing)?@/i,
  /@hire\./i,
];

const MIN_CONFIDENCE = 0.75;

/**
 * Two-stage classifier stage 1. Returns null when no rule fires with
 * >= MIN_CONFIDENCE (0.75) so the caller can fall through to LLM stage.
 * NEVER returns 'other' - that class is the LLM's fallback, not the
 * heuristic's. If nothing matches here, we honestly do not know.
 */
export function classifyEmailHeuristic(input: HeuristicInput): EmailClassification | null {
  const from = String(input.from ?? '').trim();
  const subject = String(input.subject ?? '').trim();

  // Rule 1: known job-alert senders. Precision here is effectively 1.0.
  for (const rule of JOB_ALERT_SENDERS) {
    if (rule.pattern.test(from)) {
      return {
        class: rule.cls,
        confidence: 0.99,
        evidence: `sender:${rule.pattern.source}`,
      };
    }
  }

  // Rule 2: subject-based rules.
  for (const rule of SUBJECT_RULES) {
    if (rule.pattern.test(subject)) {
      return {
        class: rule.cls,
        confidence: rule.confidence,
        evidence: `subject:${rule.pattern.source}`,
      };
    }
  }

  // Rule 3: recruiter sender hint - only fires if the subject did not
  // already resolve. Confidence intentionally at the threshold so any
  // LLM disagreement wins on the fusion pass.
  for (const pattern of RECRUITER_SENDER_HINTS) {
    if (pattern.test(from)) {
      return {
        class: 'recruiter',
        confidence: 0.76,
        evidence: `sender_hint:${pattern.source}`,
      };
    }
  }

  return null;
}

/**
 * Threshold at which the caller should trust the heuristic and skip the
 * LLM call. Exposed so the orchestrator (packages/ai/classifiers/email-
 * classifier.ts) and tests share the same value.
 */
export const HEURISTIC_TRUST_THRESHOLD = MIN_CONFIDENCE;

/**
 * Truncate a snippet before passing to the LLM. Keeps prompt cost bounded
 * and prevents a mail that pastes a 200KB HTML tree from ballooning the
 * request. 800 chars covers the classifier signal in every fixture we
 * have; expand only if a real miss appears.
 */
export function truncateSnippetForLlm(snippet: string, max = 800): string {
  const trimmed = String(snippet ?? '').replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? trimmed.slice(0, max) + ' ...' : trimmed;
}
