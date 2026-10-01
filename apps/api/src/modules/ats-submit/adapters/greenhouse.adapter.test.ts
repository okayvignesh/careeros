import { describe, expect, it, vi } from 'vitest';
import { GreenhouseAdapter } from './greenhouse.adapter';
import type { AtsCredentials, SubmitPayload } from './types';

const CREDS: AtsCredentials = { apiKey: 'gh-key', extras: { onBehalfOf: 'gh-user-1' } };
const PAYLOAD: SubmitPayload = {
  idempotencyKey: 'ikey-1',
  candidate: { name: 'Jane Doe', email: 'jane@example.com' },
  resume: { bytes: Buffer.from(''), filename: 'resume.pdf' },
  jobBoardId: '12345',
};

function makeFetch(response: { ok?: boolean; status?: number; bodyText?: string }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 201,
    text: async () => response.bodyText ?? '',
  } as Response);
}

describe('GreenhouseAdapter', () => {
  it('fails fast without onBehalfOf extra', async () => {
    const adapter = new GreenhouseAdapter(makeFetch({}) as unknown as typeof globalThis.fetch);
    const result = await adapter.submit({ apiKey: 'k' }, PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.reason).toMatch(/onBehalfOf/);
    }
  });

  it('posts to candidates endpoint with On-Behalf-Of header + Basic auth', async () => {
    const fetchFn = makeFetch({
      ok: true,
      status: 201,
      bodyText: JSON.stringify({
        id: 999,
        applications: [{ id: 42, status: 'active', url: 'https://app.greenhouse.io/apps/42' }],
      }),
    });
    const adapter = new GreenhouseAdapter(fetchFn as unknown as typeof globalThis.fetch);
    const result = await adapter.submit(CREDS, PAYLOAD);
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://harvest.greenhouse.io/v1/candidates');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Basic ' + Buffer.from('gh-key:').toString('base64'));
    expect(headers['On-Behalf-Of']).toBe('gh-user-1');
    if (result.ok) {
      expect(result.atsApplicationId).toBe('42');
    }
  });

  it('splits a single-word name into first + last (defensive)', async () => {
    const fetchFn = makeFetch({
      ok: true,
      status: 201,
      bodyText: JSON.stringify({ id: 1, applications: [{ id: 2 }] }),
    });
    const adapter = new GreenhouseAdapter(fetchFn as unknown as typeof globalThis.fetch);
    await adapter.submit(CREDS, {
      ...PAYLOAD,
      candidate: { name: 'Prince', email: 'p@example.com' },
    });
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.first_name).toBe('Prince');
    expect(body.last_name).toBe('Prince');
  });

  it('marks 429 as retryable', async () => {
    const adapter = new GreenhouseAdapter(
      makeFetch({ ok: false, status: 429, bodyText: '{"message":"slow down"}' }) as unknown as typeof globalThis.fetch,
    );
    const result = await adapter.submit(CREDS, PAYLOAD);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
    } else {
      throw new Error('expected failure');
    }
  });

  it('extracts {field: message} error shape', async () => {
    const adapter = new GreenhouseAdapter(
      makeFetch({
        ok: false,
        status: 422,
        bodyText: JSON.stringify({ errors: [{ field: 'email_addresses', message: 'is invalid' }] }),
      }) as unknown as typeof globalThis.fetch,
    );
    const result = await adapter.submit(CREDS, PAYLOAD);
    if (!result.ok) {
      expect(result.reason).toBe('email_addresses: is invalid');
      expect(result.retryable).toBe(false);
    } else {
      throw new Error('expected failure');
    }
  });
});
