# Speech-to-text (whisper.cpp)

Local, offline transcription. Nothing leaves the box. Spec:
[`plan/PLAN.md`](../plan/PLAN.md) ("Speech-to-text | whisper.cpp local,
whisper-small English").

## Service

`whisper` is a compose service in the `speech` profile, built from
[`infra/docker/Dockerfile.whisper`](../infra/docker/Dockerfile.whisper) at the
pinned upstream tag `v1.9.4`. It runs the whisper.cpp HTTP server with the
`small.en` model on the **private `internal` network only** — no egress at
runtime. The model is downloaded at image build time and seeded once into the
`whisperdata` volume on first boot.

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml \
  --profile speech up -d --build whisper
```

Set `WHISPER_URL=http://whisper:4001` in `.env` to switch the client on. api and
worker already list `whisper` in `NO_PROXY`, so the Squid egress proxy is
bypassed for this host.

### HTTP contract (whisper.cpp v1.9.x)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/health` | — | `200 {"status":"ok"}` or `503 {"status":"loading model"}` |
| `POST` | `/inference` | multipart: `file`, `response_format` (`json`\|`text`\|`verbose_json`), `language`, `prompt` | `json` → `{"text": "..."}`; `verbose_json` → `{text,language,duration,segments[]}` |
| `POST` | `/load` | multipart: `model=<path on server>` | `200` text |

`--convert` is enabled, so the server accepts browser audio (webm/ogg/etc.) and
normalises it with the bundled ffmpeg.

## Client

[`packages/stt`](../packages/stt) exports `WhisperClient` (plus
`whisperClientFromEnv()` and the `Transcript` / `SttHealth` types).

```ts
import { WhisperClient, SttUnavailableError } from '@careeros/stt';

const stt = new WhisperClient();           // reads WHISPER_URL

const health = await stt.health();         // never throws
if (!health.ok) return showDegraded(health.status); // 'unconfigured' | 'loading' | 'unreachable'

try {
  const { text, segments } = await stt.transcribe(audioBlob, {
    language: 'en',
    responseFormat: 'verbose_json',
  });
} catch (err) {
  if (err instanceof SttUnavailableError) return showSpeechNotEnabled();
  throw err;
}
```

Contract guarantees:

- **Unconfigured is graceful.** With `WHISPER_URL` blank, `health()` resolves
  `{ ok: false, status: 'unconfigured' }` and `transcribe()` throws
  `SttUnavailableError` — never a network call.
- **`health()` never throws.** Server errors/timeouts come back as
  `{ ok: false, status: 'unreachable' | 'loading', error }`.
- **`transcribe()` throws `SttError`** (with `.status`) only when configured but
  the request failed. Per-request timeout defaults to 120 s, overridable.
- `loadModel(path)` swaps to another model already on the server filesystem.

## Logging rules (AGENTS.md §7)

Transcripts are personal data. When you log around this client:

- Log `prompt_id`/`prompt_hash`, `duration_ms`, and an audio **length** — not
  transcript text or raw audio.
- Run any transcript text through `packages/shared/redact` before it reaches a
  prompt or a log line (same rule as any other free text).
- The transcript is evidence-adjacent: store it against the run, label it
  `personal`, and never send it to a model without an explicit per-call opt-in
  for the sensitivity gate.

## What P2 / P6 still need

The seam is real; the feature is intentionally not wired.

**P2 — verbal defense (`plan/phase-2-assessment-arena.md:97-98`)**
1. A `verbal_sessions` table (Prisma migration) holding the question, audio
   object key in MinIO, transcript, and grader verdict (currently blocked on the
   parallel P2 session).
2. An upload endpoint that stores audio in MinIO and calls
   `WhisperClient.transcribe(..., { responseFormat: 'verbose_json' })`.
3. The `verbal-defense-grader` agent consumes `{ text, segments }` + the
   question prompt; it already exists — it needs the transcript passed in.

**P6 — talk-track practice (`plan/phase-6-controlled-execution.md:51`)**
1. Reuse the same `verbal_sessions` runner from P2 rather than a second client.
2. Practice UI records audio, transcribes, and feeds the talk-track generator;
   gate on `health().ok` and show a "speech unavailable" state otherwise.

Both consumers instantiate `@careeros/stt`, not raw HTTP, so the server can move
or change version behind the client. No adapter lives in `apps/web`.
