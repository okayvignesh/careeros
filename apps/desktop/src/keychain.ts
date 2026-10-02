/**
 * D.4 scaffold: thin wrapper around `keytar` for the three secrets the agent
 * stores on the OS keychain:
 *   - jwt          (short-lived access token)
 *   - refreshToken (long-lived; rotates on every /pair/refresh)
 *   - deviceId     (opaque; needed to address this agent on revoke)
 *
 * All three live under the same keychain `service` so a single
 * `clearCredentials()` wipes them in one keyring call per key.
 *
 * ponytail: no encryption on top of keytar; the OS keyring is the trust
 * boundary. Upgrade path: wrap the three gets/sets in a session-sealed
 * envelope only if we start storing >3 secrets or need per-field audit.
 */

export interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export interface AgentCredentials {
  deviceId: string;
  jwt: string;
  refreshToken: string;
}

export const KEYCHAIN_ACCOUNTS = {
  deviceId: 'deviceId',
  jwt: 'jwt',
  refreshToken: 'refreshToken',
} as const;

export class Keychain {
  constructor(
    private readonly service: string,
    private readonly keytar: KeytarLike,
  ) {}

  async save(creds: AgentCredentials): Promise<void> {
    await this.keytar.setPassword(this.service, KEYCHAIN_ACCOUNTS.deviceId, creds.deviceId);
    await this.keytar.setPassword(this.service, KEYCHAIN_ACCOUNTS.jwt, creds.jwt);
    await this.keytar.setPassword(this.service, KEYCHAIN_ACCOUNTS.refreshToken, creds.refreshToken);
  }

  async load(): Promise<AgentCredentials | null> {
    const [deviceId, jwt, refreshToken] = await Promise.all([
      this.keytar.getPassword(this.service, KEYCHAIN_ACCOUNTS.deviceId),
      this.keytar.getPassword(this.service, KEYCHAIN_ACCOUNTS.jwt),
      this.keytar.getPassword(this.service, KEYCHAIN_ACCOUNTS.refreshToken),
    ]);
    if (!deviceId || !jwt || !refreshToken) return null;
    return { deviceId, jwt, refreshToken };
  }

  /** Rotate the short-lived JWT (and optionally the refresh token) in place. */
  async updateTokens(jwt: string, refreshToken?: string): Promise<void> {
    await this.keytar.setPassword(this.service, KEYCHAIN_ACCOUNTS.jwt, jwt);
    if (refreshToken) {
      await this.keytar.setPassword(this.service, KEYCHAIN_ACCOUNTS.refreshToken, refreshToken);
    }
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.keytar.deletePassword(this.service, KEYCHAIN_ACCOUNTS.deviceId),
      this.keytar.deletePassword(this.service, KEYCHAIN_ACCOUNTS.jwt),
      this.keytar.deletePassword(this.service, KEYCHAIN_ACCOUNTS.refreshToken),
    ]);
  }
}

/**
 * Factory: require keytar lazily so unit tests can inject a fake and so the
 * module loads even if the native binding is unavailable in CI.
 */
export function createKeychain(service: string): Keychain {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const keytar = require('keytar') as KeytarLike;
  return new Keychain(service, keytar);
}
