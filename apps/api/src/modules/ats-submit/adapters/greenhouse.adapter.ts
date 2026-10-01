// F.2 Greenhouse application submit adapter.
//
// Reference: https://developers.greenhouse.io/harvest.html#post-add-candidate
// Endpoint: POST https://harvest.greenhouse.io/v1/candidates
// Auth: HTTP Basic with API key as the username (empty password).
// Required header: On-Behalf-Of (Greenhouse user id). Idempotency via
// candidate dedupe on (external_id, email). The orchestrator still relies
// on our own ats_submissions unique constraint for strict idempotency.
//
// Resume upload: Greenhouse Harvest does NOT support multipart/form-data
// here; the documented path is `attachments: [{ filename, type, content,
// content_type }]` where `content` is base64 of the file bytes, inline in
// the JSON body. We send PDFs as a 'resume' attachment this way.
//
// ponytail: base64 inline instead of multipart because that's what the API
// takes. If Greenhouse ever ships a multipart file endpoint, swap to it;
// the shape of SubmitPayload.resume (bytes + filename) is already right.
//
// Rate limits: 50 req/10s burst, 200 req/minute sustained per Greenhouse
// docs. The orchestrator's retry wrapper + ats_submissions composite unique
// handle 429s.

import type {
  AtsCredentials,
  AtsSubmitAdapter,
  SubmitPayload,
  SubmitResult,
} from './types';

const GREENHOUSE_URL = 'https://harvest.greenhouse.io/v1/candidates';

export class GreenhouseAdapter implements AtsSubmitAdapter {
  readonly id = 'greenhouse' as const;

  constructor(
    private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async submit(creds: AtsCredentials, payload: SubmitPayload): Promise<SubmitResult> {
    const onBehalfOf = creds.extras?.onBehalfOf;
    if (!onBehalfOf) {
      return {
        ok: false,
        reason: 'greenhouse extras.onBehalfOf required',
        retryable: false,
      };
    }
    const [first, ...rest] = payload.candidate.name.trim().split(/\s+/);
    const last = rest.join(' ') || first || 'Candidate';
    const resumeAttachment = payload.resume.bytes.byteLength > 0
      ? {
          attachments: [
            {
              filename: payload.resume.filename || 'resume.pdf',
              type: 'resume',
              content: payload.resume.bytes.toString('base64'),
              content_type: 'application/pdf',
            },
          ],
        }
      : {};
    const body = {
      first_name: first ?? 'Candidate',
      last_name: last,
      external_id: payload.idempotencyKey,
      email_addresses: [{ value: payload.candidate.email, type: 'personal' }],
      ...(payload.candidate.phone
        ? { phone_numbers: [{ value: payload.candidate.phone, type: 'mobile' }] }
        : {}),
      ...(payload.candidate.linkedinUrl
        ? { social_media_addresses: [{ value: payload.candidate.linkedinUrl }] }
        : {}),
      ...resumeAttachment,
      applications: [
        {
          job_id: Number(payload.jobBoardId) || payload.jobBoardId,
          ...(payload.candidate.coverLetter
            ? { prospect_detail: { prospect_pool_id: null, prospect_stage_id: null } }
            : {}),
        },
      ],
    };

    let response: Response;
    try {
      response = await this.fetchFn(GREENHOUSE_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${creds.apiKey}:`).toString('base64'),
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'On-Behalf-Of': onBehalfOf,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        reason: `network: ${(err as Error).message}`,
        retryable: true,
      };
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return {
        ok: false,
        status: response.status,
        reason: 'non-json response',
        retryable: response.status >= 500,
        raw: text.slice(0, 500),
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        retryable: response.status === 429 || (response.status >= 500 && response.status < 600),
        reason: extractGreenhouseErrorMessage(parsed) ?? `HTTP ${response.status}`,
        raw: parsed,
      };
    }

    const r = parsed as {
      id?: number | string;
      applications?: Array<{ id?: number | string; status?: string; url?: string }>;
    };
    const app = r.applications?.[0];
    if (!r?.id || !app?.id) {
      return {
        ok: false,
        status: response.status,
        retryable: false,
        reason: 'greenhouse response missing candidate or application id',
        raw: parsed,
      };
    }
    return {
      ok: true,
      atsApplicationId: String(app.id),
      ...(app.url ? { confirmationUrl: app.url } : {}),
      ...(app.status ? { atsStatus: app.status } : {}),
      raw: parsed,
    };
  }
}

function extractGreenhouseErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { errors?: Array<{ message?: string; field?: string }>; message?: string };
  if (typeof b.message === 'string') return b.message;
  if (Array.isArray(b.errors) && b.errors[0]?.message) {
    const first = b.errors[0];
    return first.field ? `${first.field}: ${first.message}` : first.message!;
  }
  return null;
}
