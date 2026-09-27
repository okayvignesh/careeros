import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { LockoutError } from '../../modules/auth/auth.service';
import { LockoutExceptionFilter } from './lockout.filter';

function fakeHost(res: unknown): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
}

describe('LockoutExceptionFilter (A-C1 Retry-After)', () => {
  it('sets Retry-After header from LockoutError.retryAfterS', () => {
    const setHeader = vi.fn();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { setHeader, status, json };
    const filter = new LockoutExceptionFilter();

    filter.catch(new LockoutError(42), fakeHost(res));

    // MUTATION-SMOKE: delete `res.setHeader('Retry-After', ...)` from the
    // filter → this line goes red.
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 429, retryAfterS: 42 }),
    );
  });
});
