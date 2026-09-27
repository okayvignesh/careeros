// Sender routing. Extracts the bare email out of a raw `From:` header
// (`"LinkedIn Jobs" <jobs-noreply@linkedin.com>` -> `jobs-noreply@linkedin.com`),
// lower-cases it, then looks it up against the allowlist. Returns the matched
// source or null; callers audit `sender_not_allowlisted` on null.
import { SENDER_ALLOWLIST } from './allowlist';
import type { EmailSource } from '../types';

export { SENDER_ALLOWLIST, ALL_ALLOWLISTED_SENDERS } from './allowlist';

const ANGLE_ADDR_RE = /<([^>]+)>/;

/** Extract the bare `local@domain` out of an RFC 5322 `From:` header. */
export function extractAddress(from: string): string {
  const trimmed = (from ?? '').trim();
  if (!trimmed) return '';
  const angle = trimmed.match(ANGLE_ADDR_RE);
  const candidate = angle ? angle[1] : trimmed;
  return (candidate ?? '').trim().toLowerCase();
}

export function matchSender(from: string): EmailSource | null {
  const addr = extractAddress(from);
  if (!addr) return null;
  for (const [source, addrs] of Object.entries(SENDER_ALLOWLIST) as Array<
    [EmailSource, readonly string[]]
  >) {
    if (addrs.some((a) => a.toLowerCase() === addr)) return source;
  }
  return null;
}
