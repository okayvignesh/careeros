import { describe, expect, it, vi } from 'vitest';
import { AshbyAdapter } from './ashby.adapter';
import type { AtsCredentials, SubmitPayload } from './types';

const CREDS: AtsCredentials = { apiKey: 'ash-key' };
const PAYLOAD: SubmitPayload = {
  idempotencyKey: 'ikey-1',
  candidate: {
    name: 'Jane Candidate',
    email: 'jane@example.com',
    phone: '+1-555-0100',
    linkedinUrl: 'https://linkedin.com/in/jane',
    coverLetter: 'Hello Ashby',
  },
  resume: { bytes: Buffer.from('%PDF-1.4'), filename: 'resume.pdf' },
  jobBoardId: 'job-xyz',
};

function makeFetch(response: Partial<Response> & { bodyText?: string }): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    text: async () => response.bodyText ?? '',
  } as Response);
}

describe('AshbyAdapter', () => {
  it('posts to the application.create endpoint with Basic auth + idempotency', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          results: {
            application: {
              id: 'ash-app-1',
              status: 'active',
              applicationUrl: 'https://app.ashbyhq.com/applications/ash-app-1',
            },
          },
        }),
    } as Response);
    const adapter = new AshbyAdapter(fetchFn as unknown as typeof globalThis.fetch);
    const result = await adapter.submit(CREDS, PAYLOAD);

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.ashbyhq.com/application.create');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Basic ' + Buffer.from('ash-key:').toString('base64'));
    expect(headers['Idempotency-Key']).toBe('ikey-1');
    // Body is multipart FormData with a `json` part + `resumeFile` part.
    // No Content-Type header set manually (fetch adds the boundary).
    expect(headers['Content-Type']).toBeUndefined();
    const body = (init as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const jsonPart = body.get('json');
    expect(typeof jsonPart).toBe('string');
    const parsed = JSON.parse(jsonPart as string);
    expect(parsed.jobPostingId).toBe('job-xyz');
    expect(parsed.candidate.email).toBe('jane@example.com');
    const file = body.get('resumeFile');
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe('application/pdf');
    if (result.ok) {
      expect(result.atsApplicationId).toBe('ash-app-1');
      expect(result.confirmationUrl).toContain('ash-app-1');
    }
    // MUTATION-SMOKE: drop the Idempotency-Key header in the adapter and
    // the second assertion fails. Drop the resumeFile part and the Blob
    // assertion fails.
  });

  it('marks 429 as retryable', async () => {
    const adapter = new AshbyAdapter(
      makeFetch({ ok: false, status: 429, bodyText: '{"message":"rate limited"}' }) as typeof globalThis.fetch,
    );
    const result = await adapter.submit(CREDS, PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.status).toBe(429);
    }
  });

  it('marks 400 as non-retryable', async () => {
    const adapter = new AshbyAdapter(
      makeFetch({ ok: false, status: 400, bodyText: '{"message":"bad job id"}' }) as typeof globalThis.fetch,
    );
    const result = await adapter.submit(CREDS, PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain('bad job id');
    }
  });

  it('marks 5xx as retryable', async () => {
    const adapter = new AshbyAdapter(
      makeFetch({ ok: false, status: 503, bodyText: '{"message":"down"}' }) as typeof globalThis.fetch,
    );
    const result = await adapter.submit(CREDS, PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
    }
  });

  it('fails cleanly on network error (retryable)', async () => {
    const adapter = new AshbyAdapter(
      vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof globalThis.fetch,
    );
    const result = await adapter.submit(CREDS, PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.reason).toMatch(/network/);
    }
  });

  it('fails on malformed response', async () => {
    const adapter = new AshbyAdapter(
      makeFetch({ ok: true, status: 200, bodyText: 'not json' }) as typeof globalThis.fetch,
    );
    const result = await adapter.submit(CREDS, PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('non-json');
    }
  });

  it('fails on 2xx with missing application id (defensive)', async () => {
    const adapter = new AshbyAdapter(
      makeFetch({
        ok: true,
        status: 200,
        bodyText: '{"success":true,"results":{}}',
      }) as typeof globalThis.fetch,
    );
    const result = await adapter.submit(CREDS, PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.reason).toMatch(/missing application id/);
    }
  });
});
