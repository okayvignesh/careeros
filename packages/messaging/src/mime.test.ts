import { describe, expect, it } from 'vitest';
import {
  buildRfc822Message,
  deterministicMessageId,
  encodeHeaderText,
  encodeRawMessage,
  foldBase64,
  sanitizeHeaderValue,
} from './mime';

describe('sanitizeHeaderValue', () => {
  it('strips CR/LF so a crafted value cannot inject a header', () => {
    expect(sanitizeHeaderValue('victim@x.com\r\nBcc: attacker@evil.com')).toBe(
      'victim@x.com Bcc: attacker@evil.com',
    );
    // MUTATION-SMOKE: drop the \r\n replacement and the injected "Bcc:" still
    // sits on the same line, but a raw newline would split the header block.
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeHeaderValue('  a@b.com  ')).toBe('a@b.com');
  });
});

describe('encodeHeaderText', () => {
  it('passes ASCII through unchanged', () => {
    expect(encodeHeaderText('Hello there')).toBe('Hello there');
  });

  it('RFC 2047 encodes non-ASCII', () => {
    const out = encodeHeaderText('Café ☕');
    expect(out.startsWith('=?UTF-8?B?')).toBe(true);
    expect(out.endsWith('?=')).toBe(true);
  });
});

describe('foldBase64', () => {
  it('wraps at 76 characters with CRLF', () => {
    const folded = foldBase64('A'.repeat(160));
    const lines = folded.split('\r\n');
    expect(lines.every((l) => l.length <= 76)).toBe(true);
    expect(lines.join('')).toHaveLength(160);
  });
});

describe('deterministicMessageId', () => {
  it('is stable for the same seed and shaped like a Message-ID', () => {
    const a = deterministicMessageId('outreach:abc');
    const b = deterministicMessageId('outreach:abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^<[0-9a-f]+@careeros\.local>$/);
  });

  it('differs across seeds', () => {
    expect(deterministicMessageId('a')).not.toBe(deterministicMessageId('b'));
  });
});

describe('buildRfc822Message', () => {
  const raw = buildRfc822Message({
    to: 'jane@acme.com',
    subject: 'Hello',
    body: 'Line one\n\nLine two',
    messageId: '<fixed@careeros.local>',
    date: new Date('2026-01-02T03:04:05Z'),
  });

  it('emits required headers and a blank line before the body', () => {
    expect(raw).toContain('To: jane@acme.com');
    expect(raw).toContain('Subject: Hello');
    expect(raw).toContain('MIME-Version: 1.0');
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).toContain('Content-Transfer-Encoding: base64');
    expect(raw).toContain('Message-ID: <fixed@careeros.local>');
    expect(raw).toContain('\r\n\r\n');
  });

  it('base64-decodes the body back to the CRLF-normalized text', () => {
    const body = raw.split('\r\n\r\n')[1] ?? '';
    const decoded = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(decoded).toBe('Line one\r\n\r\nLine two');
  });

  it('includes threading headers for a reply', () => {
    const reply = buildRfc822Message({
      to: 'jane@acme.com',
      subject: 'Re: Hello',
      body: 'thanks',
      inReplyTo: '<orig@acme.com>',
      references: ['<orig@acme.com>', '<prev@acme.com>'],
    });
    expect(reply).toContain('In-Reply-To: <orig@acme.com>');
    expect(reply).toContain('References: <orig@acme.com> <prev@acme.com>');
  });

  it('neutralizes header injection in subject + recipient', () => {
    const evil = buildRfc822Message({
      to: 'jane@acme.com\r\nBcc: attacker@evil.com',
      subject: 'hi\nX-Evil: 1',
      body: 'x',
    });
    // No line starts with the injected header names.
    expect(evil).not.toMatch(/\r\nBcc:/);
    expect(evil).not.toMatch(/\r\nX-Evil:/);
  });
});

describe('encodeRawMessage', () => {
  it('produces url-safe base64 without padding', () => {
    const encoded = encodeRawMessage('hello?/world');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('hello?/world');
  });

  it('trims the trailing base64 padding for inputs that produce it', () => {
    // 11 bytes -> base64 with a single '=' pad.
    const encoded = encodeRawMessage('hello world');
    expect(encoded).not.toContain('=');
    expect(encoded).toBe(
      Buffer.from('hello world', 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, ''),
    );
  });
});
