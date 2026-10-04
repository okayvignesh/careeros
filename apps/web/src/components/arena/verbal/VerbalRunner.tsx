'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Mic, Square } from 'lucide-react';
import { Button, cn } from '@careeros/ui';
import { useApi } from '@/lib/use-api';
import {
  audioFilenameFor,
  chooseAudioMimeType,
  detectRecordingSupport,
  formatClock,
  getNextVerbalPrompt,
  gradeVerbalSession,
  startVerbalSession,
  uploadVerbalAudio,
  type AttemptResult,
  type RecordingSupport,
  type VerbalPrompt,
  type VerbalSessionView,
} from '@/lib/verbal-assessments';
import { VerbalResultCard } from './VerbalResultCard';

const noopSubscribe = () => () => {};

type Phase = 'idle' | 'creating' | 'recording' | 'uploading' | 'grading';

/**
 * Verbal-defense runner. Owns mic capture, upload, and the status transitions
 * (`transcribed` / `unavailable` / `failed`). The backend never invents a
 * score, and neither do we: a session with no transcript is offered a typed
 * fallback, not a synthetic grade.
 */
export function VerbalRunner({ skillId = '' }: { skillId?: string }) {
  const recordSupport = useSyncExternalStore<RecordingSupport>(
    noopSubscribe,
    detectRecordingSupport,
    () => 'unknown',
  );

  const load = useCallback(
    () => getNextVerbalPrompt(skillId || undefined),
    [skillId],
  );
  const { data: prompt, error: promptError, loading: promptLoading, refetch } = useApi(load);

  const [session, setSession] = useState<VerbalSessionView | null>(null);
  const [grade, setGrade] = useState<AttemptResult | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [manualTranscript, setManualTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [micBlocked, setMicBlocked] = useState(false);

  const sessionRef = useRef<VerbalSessionView | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const recordingSupported = recordSupport === 'supported' && !micBlocked;
  const busy = phase === 'creating' || phase === 'uploading' || phase === 'grading';

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      releaseMic();
    },
    [clearTimer, releaseMic],
  );

  const resetRun = useCallback(() => {
    clearTimer();
    releaseMic();
    recorderRef.current = null;
    chunksRef.current = [];
    sessionRef.current = null;
    setSession(null);
    setGrade(null);
    setManualTranscript('');
    setElapsedMs(0);
    setError(null);
    setPhase('idle');
  }, [clearTimer, releaseMic]);

  async function nextQuestion() {
    resetRun();
    await refetch();
  }

  const finalize = useCallback(
    async (sessionId: string, mimeType: string) => {
      clearTimer();
      releaseMic();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      setPhase('uploading');
      try {
        const updated = await uploadVerbalAudio(
          sessionId,
          blob,
          audioFilenameFor(blob.type || mimeType),
        );
        sessionRef.current = updated;
        setSession(updated);
        if (updated.status === 'failed') {
          setError(updated.error ?? 'Transcription failed. You can record again.');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed.');
      } finally {
        setPhase('idle');
      }
    },
    [clearTimer, releaseMic],
  );

  async function startRecording() {
    if (!prompt) return;
    setError(null);
    setGrade(null);
    setPhase('creating');
    try {
      const created = await startVerbalSession({ questionId: prompt.id });
      sessionRef.current = created;
      setSession(created);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = chooseAudioMimeType(
        (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void finalize(created.id, recorder.mimeType || mimeType || 'audio/webm');
      };
      recorder.start();
      startedAtRef.current = Date.now();
      durationRef.current = 0;
      setElapsedMs(0);
      setPhase('recording');
      timerRef.current = window.setInterval(() => {
        const value = Date.now() - startedAtRef.current;
        durationRef.current = value;
        setElapsedMs(value);
      }, 200);
    } catch (e) {
      setPhase('idle');
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setMicBlocked(true);
        setError('Microphone permission was denied. Type your answer instead.');
      } else if (name === 'NotFoundError') {
        setMicBlocked(true);
        setError('No microphone was found. Type your answer instead.');
      } else {
        setError(e instanceof Error ? e.message : 'Could not start recording.');
      }
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setPhase('uploading');
  }

  async function gradeStored() {
    const current = sessionRef.current;
    if (!current?.transcript) return;
    setPhase('grading');
    setError(null);
    try {
      const result = await gradeVerbalSession(
        current.id,
        durationRef.current > 0 ? { durationMs: durationRef.current } : {},
      );
      setGrade(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Grading failed.');
    } finally {
      setPhase('idle');
    }
  }

  async function gradeTyped() {
    if (!prompt) return;
    if (manualTranscript.trim().length === 0) {
      setError('Type what you said before grading.');
      return;
    }
    setError(null);
    try {
      let current = sessionRef.current;
      if (!current) {
        setPhase('creating');
        current = await startVerbalSession({ questionId: prompt.id });
        sessionRef.current = current;
        setSession(current);
      }
      setPhase('grading');
      const result = await gradeVerbalSession(current.id, {
        transcript: manualTranscript.trim(),
      });
      setGrade(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Grading failed.');
    } finally {
      setPhase('idle');
    }
  }

  if (promptError && !prompt) {
    return (
      <div
        data-testid="verbal-load-error"
        className="flex flex-col gap-3 rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-4 py-3.5 text-[13px] text-danger"
      >
        <span>{promptError}</span>
        <Button size="sm" variant="secondary" data-testid="verbal-retry-load" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }
  if (promptLoading || !prompt) return <Skeleton />;

  if (grade) {
    return (
      <div className="flex flex-col gap-5">
        <VerbalResultCard result={grade} />
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/arena/results/${grade.attemptId}`}>
            <Button
              variant="secondary"
              data-testid="verbal-view-attempt"
            >
              Full result <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Button onClick={nextQuestion} data-testid="verbal-new-question">
            Next prompt
          </Button>
          <Link href="/arena/verbal/history">
            <Button variant="ghost" data-testid="verbal-history-link">
              History
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const status = session?.status ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PromptCard prompt={prompt} />

      <section
        className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-6"
        aria-label="Recording"
      >
        {recordingSupported && status !== 'transcribed' && (
          <div className="flex flex-col items-center gap-4">
            {phase === 'recording' ? (
              <>
                <span className="flex items-center gap-2 text-[13px] text-danger" role="status" aria-live="polite">
                  <span className="motion-safe:animate-pulse h-2.5 w-2.5 rounded-full bg-danger" />
                  Recording
                </span>
                <span
                  data-testid="verbal-recording-timer"
                  className="font-mono text-[34px] font-medium leading-none tabular-nums text-fg"
                >
                  {formatClock(elapsedMs)}
                </span>
                <Button
                  variant="danger"
                  size="lg"
                  data-testid="verbal-stop-recording"
                  onClick={stopRecording}
                >
                  <Square className="h-4 w-4" /> Stop recording
                </Button>
              </>
            ) : (
              <>
                <span className="text-[13px] text-fg-muted">
                  Speak the answer aloud. The recording is transcribed on the server.
                </span>
                <button
                  type="button"
                  data-testid="verbal-start-recording"
                  onClick={startRecording}
                  disabled={busy}
                  className={cn(
                    'group flex h-24 w-24 items-center justify-center rounded-full border border-accent/50 bg-accent/10 text-accent',
                    'transition-[background-color,transform] hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                  aria-label="Start recording"
                >
                  <Mic className="h-8 w-8 motion-safe:transition-transform group-hover:scale-105" />
                </button>
                {(phase === 'creating' || phase === 'uploading' || phase === 'grading') && (
                  <span className="text-[12.5px] text-fg-subtle" role="status" aria-live="polite">
                    {phase === 'creating'
                      ? 'Opening session…'
                      : phase === 'uploading'
                        ? 'Transcribing…'
                        : 'Grading…'}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {!recordingSupported && (
          <Notice tone="warning">
            {micBlocked
              ? 'Recording is unavailable in this browser session. Type your answer below and it will still be graded.'
              : 'This browser does not support audio capture (MediaRecorder). Type your answer below and it will still be graded.'}
          </Notice>
        )}

        {status === 'transcribed' && session && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-accent/40 px-1.5 py-[1px] text-[11px] font-medium text-accent">
                Transcribed
              </span>
              {session.language && (
                <span className="font-mono text-[11px] text-fg-faint">{session.language}</span>
              )}
            </div>
            {session.audioUrl && (
              <audio
                controls
                src={session.audioUrl}
                data-testid="verbal-audio"
                className="w-full"
              />
            )}
            <p className="text-[13.5px] leading-relaxed text-fg">{session.transcript}</p>
            <div>
              <Button
                data-testid="verbal-grade-answer"
                onClick={gradeStored}
                disabled={busy}
              >
                {phase === 'grading' ? 'Grading…' : 'Grade this answer'}
              </Button>
            </div>
          </div>
        )}

        {status === 'unavailable' && (
          <Notice tone="warning">
            Speech-to-text is not configured on this server. The audio was stored, but no
            transcript was produced. Type what you said below to grade the answer — no score is
            invented from audio alone.
          </Notice>
        )}

        {status === 'failed' && (
          <Notice tone="danger">
            {session?.error ?? 'Transcription failed.'} The audio was stored. Record again, or type
            your answer below.
          </Notice>
        )}

        {(!recordingSupported || status === 'unavailable' || status === 'failed') && (
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-fg-subtle">Type your answer</span>
            <textarea
              data-testid="verbal-manual-transcript"
              value={manualTranscript}
              onChange={(event) => setManualTranscript(event.target.value)}
              rows={6}
              className="w-full resize-y rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg))] px-3.5 py-2.5 text-[14px] leading-relaxed text-fg focus:border-accent focus:outline-none"
              placeholder="Type the answer you would have spoken. It is graded the same way as a transcript."
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                data-testid="verbal-grade-typed"
                onClick={gradeTyped}
                disabled={busy || manualTranscript.trim().length === 0}
              >
                {phase === 'grading' ? 'Grading…' : 'Grade typed answer'}
              </Button>
              {(status === 'failed' || status === 'unavailable') && (
                <Button
                  variant="secondary"
                  data-testid="verbal-record-again"
                  onClick={nextQuestion}
                  disabled={busy}
                >
                  Record again
                </Button>
              )}
            </div>
          </label>
        )}

        {error && (
          <div
            data-testid="verbal-error"
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={nextQuestion} disabled={busy} data-testid="verbal-new-question">
          Skip prompt
        </Button>
        <Link href="/arena/verbal/history">
          <Button variant="ghost" data-testid="verbal-history-link">
            View spoken history
          </Button>
        </Link>
      </div>
    </div>
  );
}

function PromptCard({ prompt }: { prompt: VerbalPrompt }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-6">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
        <span className="rounded border border-[hsl(var(--border))] px-1.5 py-[1px] font-medium uppercase tracking-wider text-warning">
          {prompt.difficulty}
        </span>
        {prompt.skillIds.map((skillId) => (
          <span key={skillId} className="font-mono text-fg-faint">
            #{skillId}
          </span>
        ))}
      </div>
      <p data-testid="verbal-prompt" className="text-[16px] leading-relaxed text-fg">
        {prompt.prompt}
      </p>
    </section>
  );
}

function Notice({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-[var(--radius)] border px-3.5 py-2.5 text-[13px] leading-relaxed',
        tone === 'warning'
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-danger/30 bg-danger/10 text-danger',
      )}
    >
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden="true">
      <div className="h-28 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      <div className="h-44 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
    </div>
  );
}
