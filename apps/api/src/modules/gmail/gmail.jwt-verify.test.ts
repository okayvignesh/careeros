// E.4b: JWT verifier unit tests. The real google-auth-library RS256 verifier
// is not exercised here (its integration test lives inside google-auth-library
// itself); we inject a stub `Verifier` so we can drive every branch of the
// per-claim classifier (iss, aud, exp).
import { describe, expect, it } from 'vitest';
import type { TokenPayload } from 'google-auth-library';
import { PubSubJwtError, verifyPubSubJwt, type Verifier } from './gmail.jwt-verify';

const AUD = 'https://api.example.com/webhooks/gmail/push';

function payload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    iss: 'https://accounts.google.com',
    aud: AUD,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000) - 5,
    sub: 'sub',
    email: 'gmail-api-push@system.gserviceaccount.com',
    email_verified: true,
    ...overrides,
  } as TokenPayload;
}

function verifierReturning(p: TokenPayload): Verifier {
  return async () => p;
}

describe('verifyPubSubJwt', () => {
  it('accepts a valid Google JWT', async () => {
    const claims = await verifyPubSubJwt(`Bearer valid.token`, AUD, verifierReturning(payload()));
    expect(claims.issuer).toBe('https://accounts.google.com');
    expect(claims.audience).toBe(AUD);
    expect(claims.email).toBe('gmail-api-push@system.gserviceaccount.com');
  });

  it('accepts the bare-host issuer variant Google also uses', async () => {
    const claims = await verifyPubSubJwt(
      `Bearer valid.token`,
      AUD,
      verifierReturning(payload({ iss: 'accounts.google.com' })),
    );
    expect(claims.issuer).toBe('accounts.google.com');
  });

  it('401s when the Authorization header is absent', async () => {
    await expect(
      verifyPubSubJwt(undefined, AUD, verifierReturning(payload())),
    ).rejects.toMatchObject({ reason: 'missing' } satisfies Partial<PubSubJwtError>);
  });

  it('401s when the Authorization header is malformed', async () => {
    await expect(
      verifyPubSubJwt('NotBearer x', AUD, verifierReturning(payload())),
    ).rejects.toMatchObject({ reason: 'malformed' } satisfies Partial<PubSubJwtError>);
  });

  it('401s on wrong issuer', async () => {
    await expect(
      verifyPubSubJwt(
        `Bearer x`,
        AUD,
        verifierReturning(payload({ iss: 'https://evil.example.com' })),
      ),
    ).rejects.toMatchObject({ reason: 'wrong_issuer' } satisfies Partial<PubSubJwtError>);
  });

  it('401s on wrong audience', async () => {
    await expect(
      verifyPubSubJwt(
        `Bearer x`,
        AUD,
        verifierReturning(payload({ aud: 'https://someone-else/webhook' })),
      ),
    ).rejects.toMatchObject({ reason: 'wrong_audience' } satisfies Partial<PubSubJwtError>);
  });

  it('401s on expired token', async () => {
    await expect(
      verifyPubSubJwt(
        `Bearer x`,
        AUD,
        verifierReturning(payload({ exp: Math.floor(Date.now() / 1000) - 60 })),
      ),
    ).rejects.toMatchObject({ reason: 'expired' } satisfies Partial<PubSubJwtError>);
  });

  it('401s when the verifier itself throws (bad signature)', async () => {
    const badVerifier: Verifier = async () => {
      throw new Error('signature mismatch');
    };
    await expect(verifyPubSubJwt(`Bearer x`, AUD, badVerifier)).rejects.toMatchObject({
      reason: 'bad_signature',
    } satisfies Partial<PubSubJwtError>);
  });
});
