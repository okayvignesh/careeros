import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  b64urlToBytes,
  bytesToB64url,
  listPasskeys,
  removePasskey,
  serializeRegistration,
  toCreationOptions,
} from './passkey';

describe('base64url helpers', () => {
  it('round-trips arbitrary bytes without padding', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = bytesToB64url(bytes);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect([...b64urlToBytes(encoded)]).toEqual([...bytes]);
  });

  it('decodes the server challenge shape', () => {
    // "hello" -> aGVsbG8
    expect(new TextDecoder().decode(b64urlToBytes('aGVsbG8'))).toBe('hello');
  });
});

describe('toCreationOptions', () => {
  it('maps challenge + user id to ArrayBuffers and keeps unknown fields', () => {
    const challenge = bytesToB64url(new Uint8Array([1, 2, 3, 4]));
    const userId = bytesToB64url(new Uint8Array([9, 8, 7]));
    const options = toCreationOptions({
      challenge,
      rp: { name: 'Career OS', id: 'localhost' },
      user: { id: userId, name: 'a@b.co', displayName: 'A' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ id: challenge, transports: ['internal'] }],
    });
    expect(options.challenge).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(options.user.id).toEqual(new Uint8Array([9, 8, 7]));
    expect(options.excludeCredentials?.[0]?.type).toBe('public-key');
    expect(options.excludeCredentials?.[0]?.id).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});

describe('serializeRegistration', () => {
  it('encodes rawId, clientDataJSON and attestationObject as base64url', () => {
    const credential = {
      id: 'cred-1',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: new Uint8Array([4, 5]).buffer,
        attestationObject: new Uint8Array([6, 7, 8]).buffer,
        getTransports: () => ['internal'],
      },
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;

    const json = serializeRegistration(credential);
    expect(json.id).toBe('cred-1');
    expect(b64urlToBytes(json.rawId)).toEqual(new Uint8Array([1, 2, 3]));
    expect(b64urlToBytes(json.response.clientDataJSON)).toEqual(new Uint8Array([4, 5]));
    expect(b64urlToBytes(json.response.attestationObject)).toEqual(new Uint8Array([6, 7, 8]));
    expect(json.response.transports).toEqual(['internal']);
  });
});

describe('passkey api-client calls', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(
      async () =>
        new Response(status === 204 ? null : JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('lists passkeys with GET /auth/passkey/credentials', async () => {
    const fetchMock = stubFetch([]);
    await listPasskeys();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/auth/passkey/credentials')).toBe(true);
    expect(init.method).toBe('GET');
  });

  it('revokes with DELETE /auth/passkey/credentials/:id', async () => {
    const fetchMock = stubFetch(null, 204);
    await removePasskey('p-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/auth/passkey/credentials/p-1')).toBe(true);
    expect(init.method).toBe('DELETE');
  });
});
