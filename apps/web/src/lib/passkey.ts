import { apiDelete, apiGet, apiPost } from './api-client';

/**
 * WebAuthn / passkey browser client for `/auth/passkey/*` (C-P0.7 backend).
 *
 * The server returns `@simplewebauthn/server` JSON options and expects
 * `@simplewebauthn/types` response JSON. `@simplewebauthn/browser` is not a
 * dependency of the web app, so the base64url <-> ArrayBuffer ceremony is
 * implemented here against the platform WebAuthn API. No new deps.
 */

export interface PasskeyCredential {
  id: string;
  name: string | null;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

interface PublicKeyCredentialDescriptorJSON {
  id: string;
  type?: PublicKeyCredentialType;
  transports?: AuthenticatorTransport[];
}

export interface RegistrationOptionsJSON {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
}

interface AuthenticationOptionsJSON {
  challenge: string;
  rpId?: string;
  timeout?: number;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
}

export interface RegistrationResponseJSON {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: AuthenticatorTransport[];
  };
  type: PublicKeyCredentialType;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  authenticatorAttachment?: AuthenticatorAttachment | null;
}

export interface AuthenticationResponseJSON {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  type: PublicKeyCredentialType;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  authenticatorAttachment?: AuthenticatorAttachment | null;
}

/** Decode a base64url string (no padding) to bytes. Exported for tests. */
export function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode bytes to unpadded base64url. Exported for tests. */
export function bytesToB64url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Map server registration JSON to the platform `PublicKeyCredentialCreationOptions`. */
export function toCreationOptions(options: RegistrationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    challenge: b64urlToBytes(options.challenge),
    rp: options.rp,
    user: { ...options.user, id: b64urlToBytes(options.user.id) },
    pubKeyCredParams: options.pubKeyCredParams,
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.attestation === undefined ? {} : { attestation: options.attestation }),
    ...(options.authenticatorSelection === undefined
      ? {}
      : { authenticatorSelection: options.authenticatorSelection }),
    ...(options.excludeCredentials === undefined
      ? {}
      : {
          excludeCredentials: options.excludeCredentials.map((c) => ({
            id: b64urlToBytes(c.id),
            type: c.type ?? 'public-key',
            ...(c.transports === undefined ? {} : { transports: c.transports }),
          })),
        }),
  };
}

/** Map server authentication JSON to the platform `PublicKeyCredentialRequestOptions`. */
export function toRequestOptions(options: AuthenticationOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    challenge: b64urlToBytes(options.challenge),
    ...(options.rpId === undefined ? {} : { rpId: options.rpId }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.userVerification === undefined ? {} : { userVerification: options.userVerification }),
    ...(options.allowCredentials === undefined
      ? {}
      : {
          allowCredentials: options.allowCredentials.map((c) => ({
            id: b64urlToBytes(c.id),
            type: c.type ?? 'public-key',
            ...(c.transports === undefined ? {} : { transports: c.transports }),
          })),
        }),
  };
}

/** Serialize a created credential into the JSON shape the server verifies. */
export function serializeRegistration(
  credential: PublicKeyCredential,
): RegistrationResponseJSON {
  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = response.getTransports?.() ?? [];
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    response: {
      clientDataJSON: bytesToB64url(response.clientDataJSON),
      attestationObject: bytesToB64url(response.attestationObject),
      transports: transports as AuthenticatorTransport[],
    },
    type: credential.type as PublicKeyCredentialType,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment as AuthenticatorAttachment | null,
  };
}

/** Serialize a signed assertion into the JSON shape the server verifies. */
export function serializeAuthentication(
  credential: PublicKeyCredential,
): AuthenticationResponseJSON {
  const response = credential.response as AuthenticatorAssertionResponse;
  const userHandle = response.userHandle ?? undefined;
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    response: {
      clientDataJSON: bytesToB64url(response.clientDataJSON),
      authenticatorData: bytesToB64url(response.authenticatorData),
      signature: bytesToB64url(response.signature),
      ...(userHandle === undefined || userHandle === null
        ? {}
        : { userHandle: bytesToB64url(userHandle) }),
    },
    type: credential.type as PublicKeyCredentialType,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment as AuthenticatorAttachment | null,
  };
}

/** `GET /auth/passkey/credentials`. */
export function listPasskeys(): Promise<PasskeyCredential[]> {
  return apiGet<PasskeyCredential[]>('/auth/passkey/credentials');
}

/** `DELETE /auth/passkey/credentials/:id`. */
export function removePasskey(id: string): Promise<void> {
  return apiDelete<void>(`/auth/passkey/credentials/${encodeURIComponent(id)}`);
}

/**
 * Run the full registration ceremony: options -> platform prompt -> verify.
 * Throws if the browser has no WebAuthn support or the user cancels.
 */
export async function registerPasskey(name?: string): Promise<{ credentialId: string; name: string | null }> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('This browser does not support passkeys.');
  }
  const options = await apiPost<RegistrationOptionsJSON>('/auth/passkey/register/options');
  const created = (await navigator.credentials.create({
    publicKey: toCreationOptions(options),
  })) as PublicKeyCredential | null;
  if (!created) throw new Error('Passkey creation was cancelled.');
  const trimmed = name?.trim();
  return apiPost<{ credentialId: string; name: string | null }>('/auth/passkey/register/verify', {
    response: serializeRegistration(created),
    ...(trimmed ? { name: trimmed } : {}),
  });
}
