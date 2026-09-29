import { z } from 'zod';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * F.4: talk-track-generator.
 *
 * Given ONE topic (from the interview-prep plan) and the evidence
 * facts that topic cites, produce a 60-90 second verbal-answer draft
 * grounded in the candidate's real experience. Every claim MUST be
 * traceable to a fact id (`factRefs`); a talk-track that speaks to
 * facts the candidate did not supply is the failure mode this prompt
 * is designed against.
 *
 * The service (`InterviewPrepService.generateTalkTrack`) runs the
 * fact-check gate (packages/ai/src/grounded/gate.ts `runFactCheck`)
 * after generation and rejects the response if any claim's supporting
 * fact is missing or contradicted.
 */

export const TalkTrackSchema = z.object({
  draft: z.string().min(80).max(1400),
  factRefs: z.array(z.string()).min(1).max(10),
  cadenceNote: z.string().max(240).optional(),
});

export type TalkTrack = z.infer<typeof TalkTrackSchema>;

export const TalkTrackGeneratorPrompt = register({
  id: 'talk-track-generator',
  version: '1.0.0',
  system: [
    'You draft short verbal-answer scripts for interview practice.',
    'The candidate will read this aloud in 60-90 seconds; write in first person, conversational cadence, and use short paragraphs (1-3 sentences).',
    'EVERY substantive claim MUST cite a fact id from the EVIDENCE section as factRefs.',
    'Do not invent metrics, dates, project names, or team sizes that are not in the evidence.',
    'If the evidence is thin for the topic, keep the draft short and be honest that the answer is a hypothetical framing.',
    'You output JSON matching the schema exactly. Return valid JSON only, no prose around it.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'TOPIC:',
    '{{topicTitle}}',
    '',
    'TOPIC RATIONALE (from the prep plan):',
    '{{topicRationale}}',
    '',
    'CANDIDATE EVIDENCE (id + content; you may cite these only):',
    '{{evidenceCatalog}}',
    '',
    'ROLE + COMPANY CONTEXT (grounding, do not invent details):',
    '{{roleContext}}',
    '',
    'Return JSON: {"draft": string (80-1400 chars),',
    ' "factRefs": string[] (1-10 ids from CANDIDATE EVIDENCE, at least one),',
    ' "cadenceNote": string (<=240 chars, optional, e.g. "pause after the trade-off line")}',
  ].join('\n'),
  schema: TalkTrackSchema,
});
