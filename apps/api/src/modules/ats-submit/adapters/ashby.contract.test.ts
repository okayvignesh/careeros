// F.2 contract test - Ashby adapter through MSW with recorded-shape
// response fixtures. These exercise the real fetch path (not the vi.fn()
// stub) so the Content-Type negotiation + multipart boundary + JSON parse
// all travel through the same code that runs in production.
//
// Scope kept tight per the follow-up spec: one happy + one failure per
// endpoint. Status-matrix retry classification already covered by the
// unit tests next door.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createMswServer, atsFixtures } from '@careeros/testing';
import { AshbyAdapter } from './ashby.adapter';
import type { AtsCredentials, SubmitPayload } from './types';

const CREDS: AtsCredentials = { apiKey: 'ash-contract-key' };
const PAYLOAD: SubmitPayload = {
  idempotencyKey: 'contract-ikey-1',
  candidate: {
    name: 'Jane Candidate',
    email: 'jane@example.com',
    phone: '+1-555-0100',
    linkedinUrl: 'https://linkedin.com/in/jane',
  },
  // Minimal valid PDF-looking buffer so the multipart body isn't zero-length.
  resume: { bytes: Buffer.from('%PDF-1.4 contract'), filename: 'resume.pdf' },
  jobBoardId: 'job-xyz',
};

const server = createMswServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('AshbyAdapter contract (msw)', () => {
  it('happy path: 200 with recorded response → ok result + confirmation URL', async () => {
    let seenAuth: string | null = null;
    let seenIdempotency: string | null = null;
    let seenContentType: string | null = null;
    let seenJsonPart: string | null = null;
    let seenResumeType: string | null = null;
    let seenResumeBytes = 0;

    server.use(
      http.post(atsFixtures.ASHBY_APPLICATION_CREATE_URL, async ({ request }) => {
        seenAuth = request.headers.get('authorization');
        seenIdempotency = request.headers.get('idempotency-key');
        seenContentType = request.headers.get('content-type');
        const form = await request.formData();
        const json = form.get('json');
        if (typeof json === 'string') seenJsonPart = json;
        const resume = form.get('resumeFile');
        if (resume instanceof Blob) {
          seenResumeType = resume.type;
          const buf = await resume.arrayBuffer();
          seenResumeBytes = buf.byteLength;
        }
        return HttpResponse.json(atsFixtures.ashbySuccess, { status: 200 });
      }),
    );

    const adapter = new AshbyAdapter();
    const result = await adapter.submit(CREDS, PAYLOAD);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.atsApplicationId).toBe(
        atsFixtures.ashbySuccess.results.application.id,
      );
      expect(result.confirmationUrl).toBe(
        atsFixtures.ashbySuccess.results.application.applicationUrl,
      );
      expect(result.atsStatus).toBe(atsFixtures.ashbySuccess.results.application.status);
    }
    // Real request shape round-trip through fetch:
    expect(seenAuth).toBe('Basic ' + Buffer.from('ash-contract-key:').toString('base64'));
    expect(seenIdempotency).toBe('contract-ikey-1');
    expect(seenContentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seenJsonPart).not.toBeNull();
    expect(JSON.parse(seenJsonPart!).jobPostingId).toBe('job-xyz');
    expect(seenResumeType).toBe('application/pdf');
    expect(seenResumeBytes).toBe(PAYLOAD.resume.bytes.byteLength);
  });

  it('failure path: 400 with recorded error → terminal failure + reason', async () => {
    server.use(
      http.post(atsFixtures.ASHBY_APPLICATION_CREATE_URL, () =>
        HttpResponse.json(atsFixtures.ashbyFailure, { status: 400 }),
      ),
    );

    const adapter = new AshbyAdapter();
    const result = await adapter.submit(CREDS, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.retryable).toBe(false);
      expect(result.reason).toContain('jobPostingId is not open');
    }
  });
});
