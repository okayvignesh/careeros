import { describe, expect, it } from 'vitest';
import { Keychain, KEYCHAIN_ACCOUNTS, type KeytarLike } from './keychain';

/**
 * D.4 scaffold tests: pure-logic coverage of the keychain wrapper. We inject
 * a fake `KeytarLike` so the test runs under Linux CI (where keytar's native
 * binding has no OS keyring to talk to).
 */

function fakeKeytar(): KeytarLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  const key = (s: string, a: string) => `${s}::${a}`;
  return {
    store,
    async setPassword(s, a, p) {
      store.set(key(s, a), p);
    },
    async getPassword(s, a) {
      return store.get(key(s, a)) ?? null;
    },
    async deletePassword(s, a) {
      return store.delete(key(s, a));
    },
  };
}

describe('Keychain', () => {
  const service = 'test-careeros';

  it('save then load round-trips all three credentials', async () => {
    const kt = fakeKeytar();
    const kc = new Keychain(service, kt);
    await kc.save({ deviceId: 'd-1', jwt: 'j-1', refreshToken: 'r-1' });
    expect(await kc.load()).toEqual({ deviceId: 'd-1', jwt: 'j-1', refreshToken: 'r-1' });
    expect(kt.store.get(`${service}::${KEYCHAIN_ACCOUNTS.deviceId}`)).toBe('d-1');
    expect(kt.store.get(`${service}::${KEYCHAIN_ACCOUNTS.jwt}`)).toBe('j-1');
    expect(kt.store.get(`${service}::${KEYCHAIN_ACCOUNTS.refreshToken}`)).toBe('r-1');
  });

  it('load returns null when any credential is missing', async () => {
    const kt = fakeKeytar();
    const kc = new Keychain(service, kt);
    await kc.save({ deviceId: 'd', jwt: 'j', refreshToken: 'r' });
    await kt.deletePassword(service, KEYCHAIN_ACCOUNTS.refreshToken);
    expect(await kc.load()).toBeNull();
  });

  it('updateTokens rotates jwt (and optional refresh) without touching deviceId', async () => {
    const kt = fakeKeytar();
    const kc = new Keychain(service, kt);
    await kc.save({ deviceId: 'd-1', jwt: 'j-old', refreshToken: 'r-old' });
    await kc.updateTokens('j-new');
    expect(await kc.load()).toEqual({ deviceId: 'd-1', jwt: 'j-new', refreshToken: 'r-old' });
    await kc.updateTokens('j-newer', 'r-new');
    expect(await kc.load()).toEqual({ deviceId: 'd-1', jwt: 'j-newer', refreshToken: 'r-new' });
  });

  it('clear deletes every account under the service', async () => {
    const kt = fakeKeytar();
    const kc = new Keychain(service, kt);
    await kc.save({ deviceId: 'd', jwt: 'j', refreshToken: 'r' });
    await kc.clear();
    expect(await kc.load()).toBeNull();
    expect(kt.store.size).toBe(0);
  });

  it('clear is idempotent on an empty keychain', async () => {
    const kt = fakeKeytar();
    const kc = new Keychain(service, kt);
    await expect(kc.clear()).resolves.toBeUndefined();
  });
});
