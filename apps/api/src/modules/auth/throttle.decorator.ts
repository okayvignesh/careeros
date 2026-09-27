import { Throttle } from '@nestjs/throttler';

/**
 * A-C1: 5 requests per minute per IP on sign-in/sign-up and setup/account.
 * The exponential lockout inside AuthService is the second layer (per-account
 * escalation); this decorator is the raw request-rate ceiling.
 */
export function RateLimitAuth() {
  return Throttle({ default: { limit: 5, ttl: 60_000 } });
}
