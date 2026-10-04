import { ApiError, apiBrowserUrl, apiGet, apiPost, readCsrfTokenFromCookie } from './api-client';

/**
 * Verbal-defense client (`/assessments/verbal/*`). The controller is
 * unprefixed (served under `/api`), so these paths are the browser-facing ones.
 *
 * The runner owns mic capture; this module owns transport + the pure helpers
 * that make the recorder testable without a browser.
 */

export type VerbalSessionStatus = 'created' | 'transcribed' | 'graded' | 'failed' | 'unavailable';

export interface VerbalPrompt {
  id: string;
  prompt: string;
  skillIds: string[];
  difficulty: string;
}

export interface VerbalSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface VerbalSessionView {
  id: string;
  questionId: string | null;
  prompt: string;
  skillIds: string[];
  difficulty: string;
  status: VerbalSessionStatus;
  audioKey: string | null;
  audioMime: string | null;
  /** Presigned GET URL for the recording, when stored (5 min TTL). */
  audioUrl?: string;
  language: string | null;
  transcript: string | null;
  segments: VerbalSegment[] | null;
  score: number | null;
  reasoning: string | null;
  attemptId: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  transcribedAt: string | null;
  gradedAt: string | null;
}

export interface AttemptResult {
  attemptId: string;
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
  xpAwarded: number;
  totalXp: number;
  level: { level: number; xpInLevel: number; xpToNext: number; totalXp: number };
  previousLevel: number;
  leveledUp: boolean;
  streakDays: number;
  skillDeltas: Array<{
    skillId: string;
    beforeLevel: number;
    afterLevel: number;
    beforeProficiency: number;
    afterProficiency: number;
  }>;
}

export interface StartVerbalSessionInput {
  questionId?: string;
  prompt?: string;
  keyPoints?: string[];
  skillIds?: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  skillId?: string;
}

export function getNextVerbalPrompt(skillId?: string): Promise<VerbalPrompt> {
  const qs = skillId ? `?skillId=${encodeURIComponent(skillId)}` : '';
  return apiGet<VerbalPrompt>(`/assessments/verbal/next${qs}`);
}

export function startVerbalSession(input: StartVerbalSessionInput): Promise<VerbalSessionView> {
  return apiPost<VerbalSessionView>('/assessments/verbal/sessions', input);
}

export function listVerbalSessions(take = 20): Promise<VerbalSessionView[]> {
  return apiGet<VerbalSessionView[]>(`/assessments/verbal/sessions?take=${take}`);
}

export function getVerbalSession(id: string): Promise<VerbalSessionView> {
  return apiGet<VerbalSessionView>(`/assessments/verbal/sessions/${encodeURIComponent(id)}`);
}

export function gradeVerbalSession(
  id: string,
  opts: { transcript?: string; durationMs?: number } = {},
): Promise<AttemptResult> {
  const body: { transcript?: string; durationMs?: number } = {};
  if (opts.transcript !== undefined) body.transcript = opts.transcript;
  if (opts.durationMs !== undefined) body.durationMs = opts.durationMs;
  return apiPost<AttemptResult>(`/assessments/verbal/sessions/${encodeURIComponent(id)}/grade`, body);
}

/**
 * Multipart upload to the audio endpoint. The shared `apiPost` JSON-encodes
 * its body, so this is the one call that talks to `fetch` directly. It reuses
 * the api-client's base URL and CSRF cookie echo.
 */
export async function uploadVerbalAudio(
  sessionId: string,
  audio: Blob,
  filename = audioFilenameFor(audio.type),
): Promise<VerbalSessionView> {
  const form = new FormData();
  form.append('file', audio, filename);
  const headers: Record<string, string> = {};
  if (typeof document !== 'undefined') {
    const token = readCsrfTokenFromCookie(document.cookie ?? '');
    if (token) headers['x-csrf-token'] = token;
  }
  const res = await fetch(
    apiBrowserUrl(`/assessments/verbal/sessions/${encodeURIComponent(sessionId)}/audio`),
    { method: 'POST', body: form, headers, credentials: 'include', cache: 'no-store' },
  );
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg =
      (data as { message?: string } | null)?.message ?? `POST audio → ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data as VerbalSessionView;
}

// --- pure helpers (unit-tested; no browser needed) --------------------------

export interface VerbalDimensions {
  /** 0..1, or null when the grader did not emit a dimension line. */
  technicalAccuracy: number | null;
  communication: number | null;
  /** The real key-point hits, with the two dimension summary lines removed. */
  hits: string[];
}

/**
 * The grade endpoint returns an `AttemptResult` whose `hits` begin with
 * `technical <n>%` and `communication <n>%` (see `gradeVerbalSession`'s
 * `resultHits`). Those two lines are our own machine format, not user prose, so
 * lifting them back into numbers here is honest — and the only place the
 * dimension scores are exposed over HTTP.
 */
export function parseVerbalDimensions(hits: string[]): VerbalDimensions {
  let technicalAccuracy: number | null = null;
  let communication: number | null = null;
  const rest: string[] = [];
  for (const hit of hits) {
    const tech = /^technical (\d{1,3})%$/.exec(hit);
    if (tech?.[1] !== undefined) {
      technicalAccuracy = Number(tech[1]) / 100;
      continue;
    }
    const comm = /^communication (\d{1,3})%$/.exec(hit);
    if (comm?.[1] !== undefined) {
      communication = Number(comm[1]) / 100;
      continue;
    }
    rest.push(hit);
  }
  return { technicalAccuracy, communication, hits: rest };
}

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
] as const;

/** First MediaRecorder-supported candidate, else null (browser default). */
export function chooseAudioMimeType(isSupported: (type: string) => boolean): string | null {
  for (const candidate of AUDIO_MIME_CANDIDATES) {
    if (isSupported(candidate)) return candidate;
  }
  return null;
}

export function audioFilenameFor(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base === 'audio/ogg') return 'answer.ogg';
  if (base === 'audio/mp4' || base === 'audio/aac') return 'answer.m4a';
  if (base === 'audio/mpeg') return 'answer.mp3';
  if (base === 'audio/wav' || base === 'audio/x-wav') return 'answer.wav';
  return 'answer.webm';
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export type RecordingSupport = 'unknown' | 'supported' | 'unavailable';

/** Browser capability probe. Kept pure so the store snapshot is stable. */
export function detectRecordingSupport(): RecordingSupport {
  if (typeof window === 'undefined') return 'unknown';
  if (typeof window.MediaRecorder === 'undefined') return 'unavailable';
  if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
  return 'supported';
}
