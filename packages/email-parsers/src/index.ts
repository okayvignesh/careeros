// Top-level barrel. `parseEmail` is the one-call entry point every consumer
// should reach for. It:
//   1. Runs the sender allowlist (matchSender). Unknown sender -> null so the
//      caller can audit `sender_not_allowlisted` and drop the mail.
//   2. Delegates to the matched parser. Parser returns EmailJob[]; malformed
//      HTML yields [] (never throws).
//   3. Returns the assembled ParsedEmail. `receivedAt` defaults to `new Date()`
//      when the caller has no Gmail timestamp handy.
import { matchSender } from './senders';
import { parseLinkedin } from './parsers/linkedin';
import { parseIndeed } from './parsers/indeed';
import { parseNaukri } from './parsers/naukri';
import type { EmailJob, EmailSource, ParseInput, ParsedEmail } from './types';

export * from './types';
export { matchSender, extractAddress, SENDER_ALLOWLIST, ALL_ALLOWLISTED_SENDERS } from './senders';
export { parseLinkedin } from './parsers/linkedin';
export { parseIndeed } from './parsers/indeed';
export { parseNaukri } from './parsers/naukri';

const PARSERS: Record<EmailSource, (html: string, receivedAt: Date) => EmailJob[]> = {
  linkedin: parseLinkedin,
  indeed: parseIndeed,
  naukri: parseNaukri,
};

export function parseEmail(input: ParseInput): ParsedEmail | null {
  const source = matchSender(input.from);
  if (!source) return null;
  const receivedAt = input.receivedAt ?? new Date();
  let jobs: EmailJob[] = [];
  try {
    jobs = PARSERS[source](input.html ?? '', receivedAt);
  } catch {
    // Parser errors never reach the caller; empty jobs signals "layout drift,
    // fall back to LLM extraction upstream".
    jobs = [];
  }
  return {
    source,
    subject: input.subject ?? '',
    from: input.from,
    receivedAt,
    jobs,
  };
}
