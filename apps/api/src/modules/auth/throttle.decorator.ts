import { Throttle } from '@nestjs/throttler';

/**
 * A-C1: 5 requests per minute per IP on sign-in/sign-up and setup/account.
 * The exponential lockout inside AuthService is the second layer (per-account
 * escalation); this decorator is the raw request-rate ceiling.
 */
export function RateLimitAuth() {
  return Throttle({ default: { limit: 5, ttl: 60_000 } });
}

/**
 * Active-session management mutations (revoke one / revoke all others). A
 * security-sensitive write, so tighter than the global 100/min ceiling, but
 * looser than the 5/min credential ceiling so a user can clean up a handful of
 * stale sessions in one sitting.
 */
export function RateLimitSessions() {
  return Throttle({ default: { limit: 20, ttl: 60_000 } });
}
