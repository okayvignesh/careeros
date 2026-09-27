import { describe, it } from 'vitest';

describe('assertPublicUrl (A-C2 SSRF guard)', () => {
  it('rejects metadata IP, RFC1918, docker hosts, redirects to metadata; accepts allowlisted', async () => {
    await import('./assert-public-url.demo');
  });
});
