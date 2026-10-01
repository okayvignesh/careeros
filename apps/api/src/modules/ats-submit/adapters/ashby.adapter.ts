// F.2 Ashby application submit adapter.
//
// Reference: https://developers.ashbyhq.com/reference/applicationcreate
// Endpoint: POST https://api.ashbyhq.com/application.create
// Auth: HTTP Basic with API key as the username (empty password).
// Content-Type: multipart/form-data when a resume file is attached, with a
// `json` part carrying the stringified JSON body and a `resumeFile` part
// carrying the PDF bytes (per Ashby's file-upload convention). We always
// go multipart because the resume PDF is always attached in our flow.
// Idempotency: Ashby accepts an `Idempotency-Key` header; a repeat with
// the same key returns the original 2xx without creating a duplicate.
// Rate limits: 500 req/5min per org per Ashby docs; well above our
// single-user volume.

import type {
  AtsCredentials,
  AtsSubmitAdapter,
  SubmitPayload,
  SubmitResult,
} from './types';

const ASHBY_URL = 'https://api.ashbyhq.com/application.create';

export class AshbyAdapter implements AtsSubmitAdapter {
  readonly id = 'ashby' as const;

  constructor(
    private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async submit(creds: AtsCredentials, payload: SubmitPayload): Promise<SubmitResult> {
    const jsonBody = {
      jobPostingId: payload.jobBoardId,
      candidate: {
        name: payload.candidate.name,
        email: payload.candidate.email,
        ...(payload.candidate.phone ? { phoneNumber: payload.candidate.phone } : {}),
        ...(payload.candidate.linkedinUrl
          ? { socialLinks: [{ type: 'LinkedIn', url: payload.candidate.linkedinUrl }] }
          : {}),
      },
      ...(payload.candidate.coverLetter
        ? { applicationFields: { coverLetter: payload.candidate.coverLetter } }
        : {}),
    };

    // Build multipart. Ashby expects a `json` part (stringified body) + file
    // parts named by field (`resumeFile`, `coverLetterFile`, ...). Node >=18
    // provides global FormData + Blob; no extra dep.
    const form = new FormData();
    form.set('json', JSON.stringify(jsonBody));
    form.set(
      'resumeFile',
      new Blob([bufferToArrayBuffer(payload.resume.bytes)], { type: 'application/pdf' }),
      payload.resume.filename || 'resume.pdf',
    );

    let response: Response;
    try {
      response = await this.fetchFn(ASHBY_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${creds.apiKey}:`).toString('base64'),
          Accept: 'application/json',
          'Idempotency-Key': payload.idempotencyKey,
          // Content-Type is set automatically by fetch when body is FormData
          // (it must include the generated multipart boundary).
        },
        body: form,
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
      // Ashby always returns JSON; non-JSON means upstream is in a bad state.
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
        // 429 + 5xx are retryable; 4xx (except 429) is terminal.
        retryable: response.status === 429 || (response.status >= 500 && response.status < 600),
        reason: extractAshbyErrorMessage(parsed) ?? `HTTP ${response.status}`,
        raw: parsed,
      };
    }

    const result = parsed as {
      success?: boolean;
      results?: { application?: { id?: string; status?: string; applicationUrl?: string } };
    };
    if (!result?.success || !result.results?.application?.id) {
      return {
        ok: false,
        status: response.status,
        retryable: false,
        reason: 'ashby response missing application id',
        raw: parsed,
      };
    }
    const app = result.results.application;
    if (!app.id) {
      return {
        ok: false,
        status: response.status,
        retryable: false,
        reason: 'ashby response missing application id',
        raw: parsed,
      };
    }
    const out: SubmitResult = {
      ok: true,
      atsApplicationId: app.id,
      raw: parsed,
    };
    if (app.applicationUrl) (out as { confirmationUrl?: string }).confirmationUrl = app.applicationUrl;
    if (app.status) (out as { atsStatus?: string }).atsStatus = app.status;
    return out;
  }
}

function extractAshbyErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { errors?: unknown[]; message?: string };
  if (typeof b.message === 'string') return b.message;
  if (Array.isArray(b.errors) && typeof b.errors[0] === 'string') return b.errors[0];
  if (Array.isArray(b.errors) && b.errors[0] && typeof b.errors[0] === 'object') {
    const first = b.errors[0] as { message?: string };
    if (typeof first.message === 'string') return first.message;
  }
  return null;
}

// Blob's BlobPart demands a plain ArrayBuffer (not SharedArrayBuffer and not
// a Node Buffer with ArrayBufferLike backing). Copy the bytes into a fresh
// ArrayBuffer so TS accepts the Blob construction. ponytail: a copy per
// submit is fine for a single-user MVP; move to a zero-copy path when the
// resume PDF is big enough to measure (today it's typically < 200 KB).
function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return copy;
}
