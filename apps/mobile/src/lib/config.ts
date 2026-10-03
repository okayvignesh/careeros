import { Platform } from 'react-native';

/**
 * API base URL. `EXPO_PUBLIC_API_URL` is inlined at build time by Expo.
 * Dev fallbacks: Android emulators reach the host at 10.0.2.2, iOS simulators
 * and web at localhost. On a physical device set
 * `EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3001` (see README).
 */
const DEV_FALLBACK =
  Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEV_FALLBACK).replace(/\/+$/, '');
