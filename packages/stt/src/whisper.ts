// Typed client for the self-hosted whisper.cpp HTTP server (compose profile
// `speech`). It is deliberately thin: the server does the inference, this
// module only encodes the wire contract and fails predictably. When
// `WHISPER_URL` is unset the client stays inert — `health()` reports
// `unconfigured` and `transcribe()` throws `SttUnavailableError` — so callers
// can ship the seam before the speech profile is enabled.
//
// Wire contract (whisper.cpp v1.9.x, examples/server):
//   GET  /health     -> 200 {"status":"ok"} | 503 {"status":"loading model"}
//   POST /inference  -> multipart form-data: file, response_format, language, prompt
//                       response_format=json          -> {"text": "..."}
//                       response_format=text          -> plain text body
//                       response_format=verbose_json  -> {task,language,duration,text,segments[]}
//   POST /load       -> multipart form-data: model=<path on the server>
//
// See docs/stt.md for how P2 (verbal defense) and P6 (talk-track practice)
// are expected to consume this.

export type WhisperResponseFormat = 'json' | 'text' | 'verbose_json';

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptSegment[];
}

export interface TranscribeOptions {
  /** Spoken language; whisper.cpp defaults to `en`. Use `'auto'` to detect. */
  language?: string;
  /** Default `json`. `verbose_json` carries segment timestamps. */
  responseFormat?: WhisperResponseFormat;
  /** Optional initial prompt to bias decoding (e.g. the interview question). */
  prompt?: string;
  signal?: AbortSignal;
}

export type SttHealthStatus = 'ok' | 'loading' | 'unreachable' | 'unconfigured';

export interface SttHealth {
  ok: boolean;
  status: SttHealthStatus;
  latencyMs: number;
  error?: string;
}

/** Thrown when `WHISPER_URL` is not configured. Callers should degrade, not crash. */
export class SttUnavailableError extends Error {
  constructor(message = 'Speech-to-text is not configured (set WHISPER_URL)') {
    super(message);
    this.name = 'SttUnavailableError';
  }
}

/** Thrown when the server is configured but the request failed. */
export class SttError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SttError';
    if (status !== undefined) this.status = status;
  }
}

export type FetchLike = typeof fetch;

export interface WhisperClientOptions {
  /** Defaults to `process.env.WHISPER_URL`. Empty/whitespace means unconfigured. */
  url?: string;
  /** Injectable for tests. Defaults to global `fetch`. */
  fetchImpl?: FetchLike;
  /** Default per-request timeout for transcription. */
  timeoutMs?: number;
}

export class WhisperClient {
  private readonly baseUrl: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly defaultTimeoutMs: number;

  constructor(options: WhisperClientOptions = {}) {
    const url = (options.url ?? process.env.WHISPER_URL ?? '').trim();
    this.baseUrl = url.length > 0 ? url.replace(/\/+$/, '') : undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultTimeoutMs = options.timeoutMs ?? 120_000;
  }

  get configured(): boolean {
    return this.baseUrl !== undefined;
  }

  /** Liveness/model-readiness probe. Never throws; reports the failure as data. */
  async health(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<SttHealth> {
    if (!this.baseUrl) return { ok: false, status: 'unconfigured', latencyMs: 0 };
    const started = Date.now();
    try {
      const res = await this.request('/health', {
        method: 'GET',
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? 5_000,
      });
      const latencyMs = Date.now() - started;
      if (res.ok) return { ok: true, status: 'ok', latencyMs };
      const body = await safeText(res);
      return {
        ok: false,
        status: res.status === 503 ? 'loading' : 'unreachable',
        latencyMs,
        error: body || `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        status: 'unreachable',
        latencyMs: Date.now() - started,
        error: (err as Error).message,
      };
    }
  }

  /** Transcribe an audio clip. Throws `SttUnavailableError` when unconfigured. */
  async transcribe(
    audio: Blob | Uint8Array | ArrayBuffer,
    options: TranscribeOptions = {},
  ): Promise<Transcript> {
    if (!this.baseUrl) throw new SttUnavailableError();

    const format = options.responseFormat ?? 'json';
    const form = new FormData();
    form.append('file', toBlob(audio), 'audio');
    form.append('response_format', format);
    form.append('language', options.language ?? 'en');
    if (options.prompt) form.append('prompt', options.prompt);

    const res = await this.request('/inference', {
      method: 'POST',
      body: form,
      signal: options.signal,
      timeoutMs: this.defaultTimeoutMs,
    });
    if (!res.ok) {
      throw new SttError(`whisper inference failed: HTTP ${res.status} ${await safeText(res)}`, res.status);
    }
    if (format === 'text') return { text: await res.text() };

    const json = (await res.json()) as Record<string, unknown>;
    return normalizeTranscript(json);
  }

  /** Ask the server to swap in another model already present on its filesystem. */
  async loadModel(modelPath: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    if (!this.baseUrl) throw new SttUnavailableError();
    const form = new FormData();
    form.append('model', modelPath);
    const res = await this.request('/load', {
      method: 'POST',
      body: form,
      signal: options.signal,
      timeoutMs: 60_000,
    });
    if (!res.ok) {
      throw new SttError(`whisper model load failed: HTTP ${res.status}`, res.status);
    }
  }

  private async request(
    path: string,
    init: {
      method: string;
      body?: BodyInit | undefined;
      signal?: AbortSignal | undefined;
      timeoutMs: number;
    },
  ): Promise<Response> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const external = init.signal;
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    try {
      const requestInit: RequestInit = { method: init.method, signal: controller.signal };
      if (init.body !== undefined) requestInit.body = init.body;
      return await this.fetchImpl(`${this.baseUrl}${path}`, requestInit);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  }
}

/** Convenience factory so callers do not repeat env parsing. */
export function whisperClientFromEnv(options: Omit<WhisperClientOptions, 'url'> = {}): WhisperClient {
  return new WhisperClient(options);
}

function toBlob(audio: Blob | Uint8Array | ArrayBuffer): Blob {
  if (audio instanceof Blob) return audio;
  // Copy into a fresh Uint8Array<ArrayBuffer> so the view satisfies BlobPart.
  const view = audio instanceof ArrayBuffer ? new Uint8Array(audio) : new Uint8Array(audio);
  return new Blob([view], { type: 'application/octet-stream' });
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

function normalizeTranscript(json: Record<string, unknown>): Transcript {
  const out: Transcript = { text: typeof json.text === 'string' ? json.text : '' };
  if (typeof json.language === 'string') out.language = json.language;
  if (typeof json.duration === 'number') out.duration = json.duration;
  if (Array.isArray(json.segments)) {
    const segments: TranscriptSegment[] = [];
    for (const raw of json.segments) {
      if (!raw || typeof raw !== 'object') continue;
      const seg = raw as Record<string, unknown>;
      if (typeof seg.text !== 'string') continue;
      segments.push({
        id: typeof seg.id === 'number' ? seg.id : segments.length,
        start: typeof seg.start === 'number' ? seg.start : 0,
        end: typeof seg.end === 'number' ? seg.end : 0,
        text: seg.text,
      });
    }
    out.segments = segments;
  }
  return out;
}
