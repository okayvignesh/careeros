import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DailyBriefPayload,
  briefToPlainText,
  getBriefPreferences,
  updateBriefPreferences,
} from './notifications';

const basePayload: DailyBriefPayload = {
  userId: 'u1',
  composedAt: '2026-10-04T08:00:00.000Z',
  xp: { totalXp: 640, deltaLast24h: 120 },
  streak: { currentDays: 6, longestDays: 11 },
  quests: [{ id: 'q1', title: 'Redis rate limiter', skillName: 'Redis', dueAt: null }],
  jobMatches: [{ id: 'j1', title: 'Senior Backend Engineer', company: 'Acme', location: null, postedAt: null }],
  marketPulse: { risingSkill: 'AWS', snapshotAt: null },
};

describe('briefToPlainText', () => {
  it('renders the real payload fields as plain text', () => {
    const text = briefToPlainText(basePayload);
    expect(text).toContain('640 XP');
    expect(text).toContain('streak 6 days');
    expect(text).toContain('Redis rate limiter');
    expect(text).toContain('Senior Backend Engineer @ Acme');
    expect(text).toContain('AWS is rising');
  });

  it('says nothing new rather than emitting an empty shell', () => {
    const text = briefToPlainText({
      ...basePayload,
      quests: [],
      jobMatches: [],
      marketPulse: null,
    });
    expect(text).toContain('Nothing new today.');
  });
});

describe('notifications api-client calls', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(payload: unknown): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('reads preferences with GET /brief/preferences', async () => {
    const fetchMock = stubFetch(null);
    await getBriefPreferences();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/brief/preferences')).toBe(true);
    expect(init.method).toBe('GET');
  });

  it('writes preferences with POST /brief/preferences', async () => {
    const fetchMock = stubFetch({ userId: 'u1', channels: ['web'] });
    await updateBriefPreferences({ timezone: 'UTC', sendHourLocal: 8, channels: ['web'] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/brief/preferences')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      timezone: 'UTC',
      sendHourLocal: 8,
      channels: ['web'],
    });
  });
});
