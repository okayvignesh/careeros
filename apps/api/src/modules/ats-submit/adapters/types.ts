// F.2 adapter contract.
//
// Keep the shape small and transport-free. Adapters receive a
// normalised SubmitPayload + the operator-supplied credentials; they
// return a SubmitResult with the ATS confirmation ids. The service
// handles idempotency, retry, state advance, and audit log.

export interface SubmitPayload {
  idempotencyKey: string;
  candidate: {
    name: string;
    email: string;
    phone?: string;
    linkedinUrl?: string;
    githubUrl?: string;
    coverLetter?: string;
  };
  resume: {
    /** PDF bytes; adapters serialise however the ATS expects. */
    bytes: Buffer;
    filename: string;
  };
  /** Vendor-side job identifier (not our NormalizedJob.id). */
  jobBoardId: string;
}

export interface SubmitSuccess {
  ok: true;
  atsApplicationId: string;
  confirmationUrl?: string;
  atsStatus?: string;
  raw?: unknown;
}

export interface SubmitFailure {
  ok: false;
  status?: number;
  reason: string;
  retryable: boolean;
  raw?: unknown;
}

export type SubmitResult = SubmitSuccess | SubmitFailure;

export interface AtsCredentials {
  /** Opaque per-ATS secret; the orchestrator decrypts before passing in. */
  apiKey: string;
  /** Per-ATS extras (`onBehalfOf` user id for Greenhouse Harvest, etc). */
  extras?: Record<string, string>;
}

export interface AtsSubmitAdapter {
  readonly id: 'ashby' | 'greenhouse';
  submit(creds: AtsCredentials, payload: SubmitPayload): Promise<SubmitResult>;
}
