import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createDocsGate, createNonceInjector } from './docs.middleware';

interface ResState {
  statusCode: number | null;
  body: unknown;
}

function fakeRes(): { res: Response; state: ResState } {
  const state: ResState = { statusCode: null, body: undefined };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
    locals: { cspNonce: 'nonce-123' },
    getHeader: () => 'text/html; charset=utf-8',
    send: (body?: unknown) => body,
  } as unknown as Response;
  return { res, state };
}

function fakeReq(): Request {
  return {} as unknown as Request;
}

describe('createDocsGate', () => {
  it('is open in development', async () => {
    const next = vi.fn();
    createDocsGate({ isProduction: false, hasSession: async () => false })(fakeReq(), fakeRes().res, next);
    await Promise.resolve();
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 in production without a session', async () => {
    const { res, state } = fakeRes();
    const next = vi.fn();
    createDocsGate({ isProduction: true, hasSession: async () => false })(fakeReq(), res, next);
    await vi.waitFor(() => expect(state.statusCode).toBe(401));
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a valid session through in production', async () => {
    const next = vi.fn();
    createDocsGate({ isProduction: true, hasSession: async () => true })(fakeReq(), fakeRes().res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
  });

  it('fails closed when the session check throws', async () => {
    const { res, state } = fakeRes();
    const next = vi.fn();
    createDocsGate({
      isProduction: true,
      hasSession: async () => {
        throw new Error('db down');
      },
    })(fakeReq(), res, next);
    await vi.waitFor(() => expect(state.statusCode).toBe(401));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('createNonceInjector', () => {
  it('stamps the CSP nonce onto inline script/style tags in HTML', () => {
    const { res } = fakeRes();
    const next = vi.fn();
    createNonceInjector()(fakeReq(), res, next);
    const out = res.send('<script>go()</script><style>.x{}</style>') as unknown as string;
    expect(out).toContain('<script nonce="nonce-123">');
    expect(out).toContain('<style nonce="nonce-123">');
    expect(next).toHaveBeenCalled();
  });
});
