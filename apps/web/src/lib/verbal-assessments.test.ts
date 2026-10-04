import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  audioFilenameFor,
  chooseAudioMimeType,
  detectRecordingSupport,
  formatClock,
  getNextVerbalPrompt,
  getVerbalSession,
  gradeVerbalSession,
  listVerbalSessions,
  parseVerbalDimensions,
  startVerbalSession,
  uploadVerbalAudio,
} from './verbal-assessments';

function stubFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('verbal-assessments api calls', () => {
  it('loads the next prompt, optionally scoped to a skill', async () => {
    const fetchMock = stubFetch({ id: 'q1', prompt: 'p', skillIds: [], difficulty: 'medium' });
    await getNextVerbalPrompt('node-js');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/assessments/verbal/next?skillId=node-js')).toBe(true);
    expect(init.method).toBe('GET');

    await getNextVerbalPrompt();
    expect(String((fetchMock.mock.calls[1] as [string])[0]).endsWith('/assessments/verbal/next')).toBe(
      true,
    );
  });

  it('starts a session with a POST to /assessments/verbal/sessions', async () => {
    const fetchMock = stubFetch({ id: 's1' }, 201);
    await startVerbalSession({ questionId: 'q1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/assessments/verbal/sessions')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ questionId: 'q1' });
  });

  it('lists sessions with the take window', async () => {
    const fetchMock = stubFetch([]);
    await listVerbalSessions(20);
    expect(
      String((fetchMock.mock.calls[0] as [string])[0]).endsWith(
        '/assessments/verbal/sessions?take=20',
      ),
    ).toBe(true);
  });

  it('fetches a single session by id', async () => {
    const fetchMock = stubFetch({ id: 's1' });
    await getVerbalSession('s1');
    expect(
      String((fetchMock.mock.calls[0] as [string])[0]).endsWith('/assessments/verbal/sessions/s1'),
    ).toBe(true);
  });

  it('grades with only the fields the caller supplied', async () => {
    const fetchMock = stubFetch({ attemptId: 'a1' });
    await gradeVerbalSession('s1', { transcript: 'hello', durationMs: 1234 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/assessments/verbal/sessions/s1/grade')).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ transcript: 'hello', durationMs: 1234 });

    await gradeVerbalSession('s1', {});
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toEqual(
      {},
    );
  });

  it('uploads audio as multipart under the `file` field', async () => {
    const fetchMock = stubFetch({ id: 's1', status: 'transcribed' });
    const blob = new Blob(['bytes'], { type: 'audio/webm' });
    await uploadVerbalAudio('s1', blob);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/assessments/verbal/sessions/s1/audio');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const file = (init.body as FormData).get('file');
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe('answer.webm');
    // Explicitly NOT application/json — the browser must set the multipart boundary.
    expect(init.headers).toEqual({});
  });

  it('raises ApiError with the server message on a failed upload', async () => {
    stubFetch({ message: 'audio exceeds limit' }, 413);
    await expect(uploadVerbalAudio('s1', new Blob(['x'], { type: 'audio/webm' }))).rejects.toThrow(
      'audio exceeds limit',
    );
  });
});

describe('parseVerbalDimensions', () => {
  it('lifts the technical/communication summary lines back into numbers', () => {
    const dims = parseVerbalDimensions(['technical 90%', 'communication 70%', 'virtual DOM', 'keys']);
    expect(dims.technicalAccuracy).toBeCloseTo(0.9, 5);
    expect(dims.communication).toBeCloseTo(0.7, 5);
    expect(dims.hits).toEqual(['virtual DOM', 'keys']);
  });

  it('reports null dimensions rather than inventing a figure', () => {
    const dims = parseVerbalDimensions(['mentions caching']);
    expect(dims.technicalAccuracy).toBeNull();
    expect(dims.communication).toBeNull();
    expect(dims.hits).toEqual(['mentions caching']);
  });
});

describe('recorder helpers', () => {
  it('chooses the first supported mime type, or null for the browser default', () => {
    expect(chooseAudioMimeType((t) => t === 'audio/webm')).toBe('audio/webm');
    expect(chooseAudioMimeType((t) => t === 'audio/webm;codecs=opus')).toBe(
      'audio/webm;codecs=opus',
    );
    expect(chooseAudioMimeType(() => false)).toBeNull();
  });

  it('derives an upload filename from the mime type', () => {
    expect(audioFilenameFor('audio/webm;codecs=opus')).toBe('answer.webm');
    expect(audioFilenameFor('audio/ogg')).toBe('answer.ogg');
    expect(audioFilenameFor('audio/mp4')).toBe('answer.m4a');
    expect(audioFilenameFor('')).toBe('answer.webm');
  });

  it('formats the recorder clock as mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(3_661_000)).toBe('61:01');
  });

  it('detects recording support from window + MediaRecorder', () => {
    expect(detectRecordingSupport()).toBe('unknown');

    vi.stubGlobal('window', {});
    expect(detectRecordingSupport()).toBe('unavailable');

    vi.stubGlobal('window', { MediaRecorder: function MediaRecorder() {} });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => {} } });
    expect(detectRecordingSupport()).toBe('supported');
  });
});
