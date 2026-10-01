// F.2 contract test - Greenhouse Harvest candidates adapter through MSW
// with recorded-shape response fixtures. One happy + one failure.
//
// Greenhouse Harvest doesn't do multipart for candidate create; resumes
// go inline as base64 attachments. We assert the attachment made it into
// the JSON body + round-trips the full response envelope on happy path.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createMswServer, atsFixtures } from '@careeros/testing';
import { GreenhouseAdapter } from './greenhouse.adapter';
import type { AtsCredentials, SubmitPayload } from './types';

const CREDS: AtsCredentials = {
  apiKey: 'gh-contract-key',
  extras: { onBehalfOf: 'gh-user-1' },
};
const PAYLOAD: SubmitPayload = {
  idempotencyKey: 'contract-ikey-1',
  candidate: {
    name: 'Jane Candidate',
    email: 'jane@example.com',
    phone: '+1-555-0100',
    linkedinUrl: 'https://linkedin.com/in/jane',
  },
  resume: { bytes: Buffer.from('%PDF-1.4 contract'), filename: 'resume.pdf' },
  jobBoardId: '12345',
};

const server = createMswServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('GreenhouseAdapter contract (msw)', () => {
  it('happy path: 201 with recorded response → ok result + application id', async () => {
    let seenAuth: string | null = null;
    let seenOnBehalfOf: string | null = null;
    let seenBody: Record<string, unknown> | null = null;

    server.use(
      http.post(atsFixtures.GREENHOUSE_CANDIDATES_URL, async ({ request }) => {
        seenAuth = request.headers.get('authorization');
        seenOnBehalfOf = request.headers.get('on-behalf-of');
        seenBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(atsFixtures.greenhouseSuccess, { status: 201 });
      }),
    );

    const adapter = new GreenhouseAdapter();
    const result = await adapter.submit(CREDS, PAYLOAD);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.atsApplicationId).toBe(
        String(atsFixtures.greenhouseSuccess.applications[0].id),
      );
      expect(result.confirmationUrl).toBe(
        atsFixtures.greenhouseSuccess.applications[0].url,
      );
      expect(result.atsStatus).toBe(atsFixtures.greenhouseSuccess.applications[0].status);
    }

    expect(seenAuth).toBe('Basic ' + Buffer.from('gh-contract-key:').toString('base64'));
    expect(seenOnBehalfOf).toBe('gh-user-1');
    expect(seenBody).not.toBeNull();
    const body = seenBody as unknown as {
      first_name: string;
      last_name: string;
      external_id: string;
      attachments?: Array<{ filename: string; type: string; content: string; content_type: string }>;
      applications?: Array<{ job_id: number | string }>;
    };
    expect(body.first_name).toBe('Jane');
    expect(body.last_name).toBe('Candidate');
    expect(body.external_id).toBe('contract-ikey-1');
    expect(body.attachments).toBeDefined();
    expect(body.attachments).toHaveLength(1);
    const att = body.attachments![0]!;
    expect(att.type).toBe('resume');
    expect(att.content_type).toBe('application/pdf');
    // base64 of our PDF buffer round-trips to the same bytes.
    expect(Buffer.from(att.content, 'base64').equals(PAYLOAD.resume.bytes)).toBe(true);
    expect(body.applications![0]!.job_id).toBe(12345);
  });

  it('failure path: 422 with recorded error → terminal failure + field:message reason', async () => {
    server.use(
      http.post(atsFixtures.GREENHOUSE_CANDIDATES_URL, () =>
        HttpResponse.json(atsFixtures.greenhouseFailure, { status: 422 }),
      ),
    );

    const adapter = new GreenhouseAdapter();
    const result = await adapter.submit(CREDS, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe('applications/0/job_id: Must be a valid Greenhouse job id');
    }
  });
});
