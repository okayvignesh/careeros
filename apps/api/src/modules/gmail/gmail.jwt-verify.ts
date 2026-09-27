// E.4: Google Pub/Sub push JWT verifier.
//
// Google signs every push it delivers with an RS256 JWT (`Authorization:
// Bearer <jwt>`), issued by `https://accounts.google.com`, `aud` set to the
// endpoint the operator registered on the push subscription. Verifying it is
// non-negotiable - it's the only thing that proves the payload came from
// Google and not from any random attacker who guessed our webhook URL.
//
// google-auth-library already ships an RS256 verifier that pulls Google's
// public keys with correct caching + rotation (`OAuth2Client.verifyIdToken`).
// This module is a thin wrapper so the service + tests can swap the verifier
// with a fake without pulling google-auth-library into unit tests.
import { OAuth2Client, type TokenPayload } from 'google-auth-library';

// One shared client instance - verifyIdToken is stateless w.r.t. clientId and
// the internal JWK cache is what makes repeat calls cheap.
const client = new OAuth2Client();

export interface PubSubJwtClaims {
  email: string | undefined; /// service account email that signed the push
  emailVerified: boolean;
  audience: string;
  issuer: string;
}

export class PubSubJwtError extends Error {
  constructor(
    public readonly reason:
      | 'missing'
      | 'malformed'
      | 'bad_signature'
      | 'wrong_issuer'
      | 'wrong_audience'
      | 'expired',
  ) {
    super(`pubsub_jwt_${reason}`);
  }
}

// Accepted issuers. Google historically issues from both "accounts.google.com"
// and "https://accounts.google.com"; both are equivalent per the Pub/Sub docs.
const ACCEPTED_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Verify a Pub/Sub push JWT.
 *
 * @param authorizationHeader the raw `authorization` request header value
 *                            (`Bearer <jwt>` - both parts required).
 * @param expectedAudience    the exact `aud` value Google will sign for. This
 *                            is whatever URL you configured on the push
 *                            subscription; typically the public webhook URL.
 * @param verify              overridable verifier (production uses google-auth
 *                            -library; tests inject a stub). Returns the
 *                            decoded TokenPayload on success, throws on any
 *                            failure. `iss` / `aud` / `exp` are re-checked
 *                            here so we can classify the reject.
 */
export async function verifyPubSubJwt(
  authorizationHeader: string | undefined,
  expectedAudience: string,
  verify: Verifier = defaultVerifier(expectedAudience),
): Promise<PubSubJwtClaims> {
  if (!authorizationHeader) throw new PubSubJwtError('missing');
  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new PubSubJwtError('malformed');
  }

  let payload: TokenPayload;
  try {
    payload = await verify(token);
  } catch {
    throw new PubSubJwtError('bad_signature');
  }

  // google-auth-library already validates `aud`, `exp`, and signature, but we
  // re-check here so the caller can distinguish a bad audience from a bad
  // signature (both are 401 for the client but different for the audit log).
  if (!payload.iss || !ACCEPTED_ISSUERS.has(payload.iss)) {
    throw new PubSubJwtError('wrong_issuer');
  }
  const aud = typeof payload.aud === 'string' ? payload.aud : payload.aud?.[0];
  if (aud !== expectedAudience) throw new PubSubJwtError('wrong_audience');
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new PubSubJwtError('expired');

  return {
    email: payload.email,
    emailVerified: payload.email_verified === true,
    audience: aud,
    issuer: payload.iss,
  };
}

// -----------------------------------------------------------------------------
// Verifier abstraction (production wires google-auth-library; tests stub).
// -----------------------------------------------------------------------------

export type Verifier = (token: string) => Promise<TokenPayload>;

function defaultVerifier(expectedAudience: string): Verifier {
  return async (token: string) => {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: expectedAudience,
    });
    const payload = ticket.getPayload();
    if (!payload) throw new Error('empty payload');
    return payload;
  };
}
