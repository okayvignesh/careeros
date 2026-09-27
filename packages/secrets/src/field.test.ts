import { describe, it } from 'vitest';

describe('field encryption (per-purpose HKDF, AES-GCM)', () => {
  it('8 scenarios: round-trip, idempotency, backwards-compat, purpose-binding, master-binding, IV uniqueness, JSON round-trip, malformed rejection', async () => {
    await import('./field.demo');
  });
});
