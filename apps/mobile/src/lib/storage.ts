import * as SecureStore from 'expo-secure-store';
import type { MobileSession } from './types';

/**
 * Token persistence. The session blob (JWT + refresh token + device id) lives
 * in the OS keychain / keystore via expo-secure-store, never in AsyncStorage —
 * same posture as the desktop agent's `keytar` store.
 */
const KEY = 'careeros.mobile.session';

export async function loadSession(): Promise<MobileSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MobileSession>;
    if (
      typeof parsed.deviceId === 'string' &&
      typeof parsed.userId === 'string' &&
      typeof parsed.jwt === 'string' &&
      typeof parsed.refreshToken === 'string'
    ) {
      return {
        deviceId: parsed.deviceId,
        userId: parsed.userId,
        email: typeof parsed.email === 'string' ? parsed.email : '',
        jwt: parsed.jwt,
        refreshToken: parsed.refreshToken,
        expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : '',
      };
    }
  } catch {
    // Corrupt blob: treat as signed out.
  }
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  return null;
}

export async function saveSession(session: MobileSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}
