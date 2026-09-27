import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PasskeyController } from './passkey.controller';
import { RecoveryCodesController } from './recovery.controller';

// @nestjs/throttler v6 does not re-export its constants from the barrel, so
// we hard-code the metadata key prefixes here (stable — see
// throttler.constants.ts in the package). If a major bump changes them the
// test flips red on the next CI run, which is exactly what we want.
const THROTTLER_LIMIT_KEY = 'THROTTLER:LIMIT';
const THROTTLER_TTL_KEY = 'THROTTLER:TTL';

/**
 * C-P0.7 smoke: assert that @RateLimitAuth() metadata (5 req/min per IP)
 * actually rides every controller method that plan security.md item 3 says
 * needs it. If a future edit strips the decorator, this test goes red.
 *
 * `@Throttle({ default: {...} })` in @nestjs/throttler v6 stamps metadata
 * keys `THROTTLER_TTL + name` and `THROTTLER_LIMIT + name` (see
 * throttler.decorator.js) — one per throttler group. Our `RateLimitAuth()`
 * uses the `default` group.
 */

function hasThrottleMeta(target: object, methodName: string): boolean {
  const proto = (target as { prototype: Record<string, unknown> }).prototype;
  const method = proto[methodName];
  const candidates: unknown[] = [method];
  const desc = Object.getOwnPropertyDescriptor(proto, methodName);
  if (desc?.value && desc.value !== method) candidates.push(desc.value);
  for (const c of candidates) {
    if (!c) continue;
    const keys = Reflect.getMetadataKeys(c as object) as string[];
    const hasLimit = keys.some((k) => k.startsWith(THROTTLER_LIMIT_KEY));
    const hasTtl = keys.some((k) => k.startsWith(THROTTLER_TTL_KEY));
    if (hasLimit && hasTtl) return true;
  }
  return false;
}

describe('C-P0.7 rate-limit metadata (@RateLimitAuth on hot paths)', () => {
  it('PasskeyController register + login endpoints carry throttle metadata', () => {
    expect(hasThrottleMeta(PasskeyController, 'registerOptions')).toBe(true);
    expect(hasThrottleMeta(PasskeyController, 'registerVerify')).toBe(true);
    expect(hasThrottleMeta(PasskeyController, 'loginOptions')).toBe(true);
    expect(hasThrottleMeta(PasskeyController, 'loginVerify')).toBe(true);
    // MUTATION-SMOKE: strip @RateLimitAuth() from any of the four handlers
    // and this test flips red — the endpoint would silently fall back to
    // the global 100 req/min cap, blowing security.md item 3.
  });

  it('RecoveryCodesController generate + redeem carry throttle metadata', () => {
    expect(hasThrottleMeta(RecoveryCodesController, 'generate')).toBe(true);
    expect(hasThrottleMeta(RecoveryCodesController, 'redeem')).toBe(true);
  });
});
