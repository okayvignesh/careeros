import { describe, expect, it } from 'vitest';
import { extractAddress, matchSender, ALL_ALLOWLISTED_SENDERS, SENDER_ALLOWLIST } from './index';

describe('sender allowlist', () => {
  it('matches every allowlisted address to its source', () => {
    for (const [source, addrs] of Object.entries(SENDER_ALLOWLIST)) {
      for (const a of addrs) {
        expect(matchSender(a)).toBe(source);
      }
    }
  });

  it('is case-insensitive on the address', () => {
    expect(matchSender('Jobs-NoReply@LinkedIn.com')).toBe('linkedin');
    expect(matchSender('ALERT@INDEED.COM')).toBe('indeed');
  });

  it('handles display-name + angle-brackets', () => {
    expect(matchSender('"LinkedIn Jobs" <jobs-noreply@linkedin.com>')).toBe('linkedin');
    expect(matchSender('Naukri <mailer@naukri.com>')).toBe('naukri');
  });

  it('returns null for unknown sender', () => {
    expect(matchSender('spam@example.com')).toBeNull();
    expect(matchSender('recruiter@some-company.com')).toBeNull();
  });

  it('returns null for empty / malformed from header', () => {
    expect(matchSender('')).toBeNull();
    expect(matchSender('   ')).toBeNull();
    expect(matchSender('not-an-email')).toBeNull();
  });

  it('extractAddress strips display name + lower-cases', () => {
    expect(extractAddress('"Foo" <BAR@example.com>')).toBe('bar@example.com');
    expect(extractAddress('baz@example.com')).toBe('baz@example.com');
  });

  it('allowlist size matches spec (LinkedIn 3, Indeed 3, Naukri 2 = 8)', () => {
    expect(ALL_ALLOWLISTED_SENDERS.length).toBe(8);
  });
});
