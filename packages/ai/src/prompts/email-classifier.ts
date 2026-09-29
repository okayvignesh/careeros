import { EmailClassificationSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * E.5 stage 2: LLM email classifier.
 *
 * Called when the heuristic (packages/shared/src/email-classifier.ts) does
 * not fire with sufficient confidence. Input is (sender, subject, truncated
 * snippet). Output is `{class, confidence, evidence?}` per
 * `EmailClassificationSchema`.
 *
 * The snippet is untrusted user text (a recruiter or an attacker can put
 * anything in the body); UNTRUSTED_SYSTEM_CLAUSE keeps the model on task
 * and refuses to follow injected instructions. Caller MUST already have
 * gone through wrapUntrusted('email') at the ingest gate - this prompt
 * assumes it.
 *
 * ponytail: the class list is duplicated across the enum in the schema,
 * the userTemplate below, and the heuristic. Kept in sync with a
 * membership test in email-classifier.test.ts so a divergence is caught
 * at CI time, not in production drift.
 */
export const EmailClassifierPrompt = register({
  id: 'email-classifier',
  version: '1.0.0',
  system: [
    'You classify inbound email into a single category for a career-development tool.',
    'The email may include recruiter outreach, interview invites, assessment invites, rejections, offers, or automated job alerts.',
    'Choose exactly one class from the enum. If nothing fits, return "other".',
    'Confidence is your own certainty in [0, 1]. Return >= 0.9 only when the class is unambiguous.',
    'Evidence is a short (< 240 chars) quote or paraphrase of the signal you used. Do not include PII beyond what the mail already exposed to us.',
    'Return valid JSON only, matching the schema exactly.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Classes (choose exactly one):',
    '  recruiter           - proactive outreach from a recruiter or sourcing team',
    '  interview_invite    - scheduling or invitation to interview',
    '  assessment          - link to a coding test, take-home, or online assessment',
    '  rejection           - decision to not move forward',
    '  offer               - formal or informal offer of employment',
    '  job_alert_linkedin  - automated LinkedIn job alert digest',
    '  job_alert_indeed    - automated Indeed job alert digest',
    '  job_alert_naukri    - automated Naukri job alert digest',
    '  other               - fallback; personal mail, newsletters, billing, security notices, etc.',
    '',
    'Email:',
    '  From: {{from}}',
    '  Subject: {{subject}}',
    '  Snippet: {{snippet}}',
    '',
    'Return JSON: {"class": <one of the classes>, "confidence": number in [0,1], "evidence": string (<= 240 chars, optional)}.',
  ].join('\n'),
  schema: EmailClassificationSchema,
});
