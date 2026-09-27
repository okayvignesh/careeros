// Sender allowlist — first gate before any HTML parsing. Any `from` that does
// not match one of these exact addresses is dropped with a
// `sender_not_allowlisted` audit event on the consumer side. Kept as a plain
// lookup map so callers can also read the set for admin/status UIs.
//
// ponytail: exact-address match (case-insensitive), no regex. LinkedIn/Indeed
// /Naukri all send from stable envelopes; upgrade to per-domain regex when a
// vendor rotates sender addresses per campaign.
import type { EmailSource } from '../types';

export const SENDER_ALLOWLIST: Record<EmailSource, readonly string[]> = {
  linkedin: [
    'jobs-noreply@linkedin.com',
    'jobalerts-noreply@linkedin.com',
    'noreply@linkedin.com',
  ],
  indeed: [
    'alert@indeed.com',
    'donotreply@indeed.com',
    'emails@indeed.com',
  ],
  naukri: [
    'mailer@naukri.com',
    'alerts@naukri.com',
  ],
};

export const ALL_ALLOWLISTED_SENDERS: readonly string[] = Object.values(SENDER_ALLOWLIST).flat();
