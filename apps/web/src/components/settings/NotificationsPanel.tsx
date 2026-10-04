'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Bell, BellOff, Play, Save } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input } from '@careeros/ui';
import {
  type BriefPreferences,
  type DailyBriefPayload,
  type IntegrationSummary,
  briefToPlainText,
  getBriefPreferences,
  listIntegrations,
  previewBrief,
  setBriefEnabled,
  snoozeBrief,
  updateBriefPreferences,
} from '@/lib/notifications';

const TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
];

const CHANNELS = ['web', 'slack'] as const;

/**
 * E.3 notifications: the daily-brief schedule, delivery channels, snooze, and a
 * plain-text preview of exactly what would be delivered. Grounded in the real
 * `/brief/*` endpoints and the `/integrations` connection state.
 */
export function NotificationsPanel() {
  const [prefs, setPrefs] = useState<BriefPreferences | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<DailyBriefPayload | null>(null);

  useEffect(() => {
    getBriefPreferences()
      .then(setPrefs)
      .catch((e) => setError((e as Error).message));
    listIntegrations()
      .then(setIntegrations)
      .catch(() => setIntegrations([]));
  }, []);

  const slackConnected = integrations.some((i) => i.kind === 'slack' && i.status === 'connected');

  async function run(key: string, fn: () => Promise<BriefPreferences>) {
    setBusy(key);
    setError(null);
    try {
      setPrefs(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!prefs) return;
    await run('save', () =>
      updateBriefPreferences({
        timezone: prefs.timezone,
        sendHourLocal: prefs.sendHourLocal,
        channels: prefs.channels,
      }),
    );
  }

  async function onPreview() {
    setBusy('preview');
    setError(null);
    try {
      setPreview(await previewBrief());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !prefs) {
    return (
      <div role="alert" className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!prefs) return <Skeleton />;

  const enabled = prefs.isEnabled;
  const snoozed = prefs.snoozedUntil && new Date(prefs.snoozedUntil) > new Date();

  return (
    <div className="flex flex-col gap-8" data-testid="notifications-panel">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4">
        <div className="flex items-center gap-3">
          {enabled ? (
            <Bell className="h-4 w-4 text-success" />
          ) : (
            <BellOff className="h-4 w-4 text-fg-subtle" />
          )}
          <div className="flex flex-col">
            <span className="text-[14px] font-medium text-fg">
              Daily brief is {enabled ? 'on' : 'off'}
            </span>
            <span className="text-[12px] text-fg-muted">
              {prefs.lastSentAt
                ? `Last delivered ${new Date(prefs.lastSentAt).toLocaleString()}`
                : 'Never delivered yet'}
              {snoozed && prefs.snoozedUntil
                ? ` · snoozed until ${new Date(prefs.snoozedUntil).toLocaleDateString()}`
                : ''}
            </span>
          </div>
        </div>
        <Button
          data-testid="brief-toggle"
          variant={enabled ? 'secondary' : 'primary'}
          disabled={busy === 'toggle'}
          onClick={() => run('toggle', () => setBriefEnabled(!enabled))}
        >
          {busy === 'toggle' ? (
            <>
              <ThinkingOrb state="working" size={20} /> Updating
            </>
          ) : enabled ? (
            'Turn off'
          ) : (
            'Turn on'
          )}
        </Button>
      </section>

      <form onSubmit={onSave} className="flex flex-col gap-5" data-testid="brief-schedule">
        <h2 className="text-[15px] font-medium text-fg">Timing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Timezone</span>
            <Input
              data-testid="brief-timezone"
              list="brief-timezones"
              value={prefs.timezone}
              onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}
              placeholder="Asia/Kolkata"
            />
            <datalist id="brief-timezones">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            <span className="text-[11.5px] text-fg-faint">IANA name. The server converts to UTC.</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Send hour (local)</span>
            <select
              data-testid="brief-hour"
              value={prefs.sendHourLocal}
              onChange={(e) => setPrefs({ ...prefs, sendHourLocal: Number(e.target.value) })}
              className="h-11 w-full rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev))/0.6] px-3.5 text-sm text-fg focus:border-accent focus:outline-none"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12px] font-medium text-fg-subtle">Channels</legend>
          <div className="flex flex-wrap gap-4">
            {CHANNELS.map((channel) => {
              const active = prefs.channels.includes(channel);
              return (
                <label key={channel} className="flex items-center gap-2 text-[13.5px] text-fg">
                  <input
                    type="checkbox"
                    data-testid={`brief-channel-${channel}`}
                    checked={active}
                    onChange={(e) =>
                      setPrefs({
                        ...prefs,
                        channels: e.target.checked
                          ? [...prefs.channels, channel]
                          : prefs.channels.filter((c) => c !== channel),
                      })
                    }
                    className="h-4 w-4"
                  />
                  {channel === 'slack' ? 'Slack direct message' : 'In-app'}
                </label>
              );
            })}
          </div>
          <span className="text-[11.5px] text-fg-faint">
            {slackConnected
              ? 'Slack is connected.'
              : 'Slack is not connected — enable it under Integrations before choosing it.'}
          </span>
        </fieldset>

        {error && (
          <div role="alert" data-testid="brief-error" className="text-[12.5px] text-danger">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" data-testid="brief-save" disabled={busy === 'save'}>
            {busy === 'save' ? (
              <>
                <ThinkingOrb state="working" size={20} /> Saving
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save schedule
              </>
            )}
          </Button>
          <span className="text-[11.5px] text-fg-faint">
            {snoozed && prefs.snoozedUntil
              ? `Snoozed until ${new Date(prefs.snoozedUntil).toLocaleDateString()}`
              : 'Not snoozed'}
          </span>
        </div>
      </form>

      <section className="flex flex-wrap items-center gap-2" data-testid="brief-snooze">
        <span className="text-[12px] font-medium text-fg-subtle">Snooze</span>
        {[0, 1, 3, 7, 14].map((days) => (
          <Button
            key={days}
            size="sm"
            variant="ghost"
            data-testid={`brief-snooze-${days}`}
            disabled={busy === `snooze-${days}`}
            onClick={() => run(`snooze-${days}`, () => snoozeBrief(days))}
          >
            {days === 0 ? 'Clear' : `${days}d`}
          </Button>
        ))}
      </section>

      <section className="flex flex-col gap-3" data-testid="brief-preview">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium text-fg">Preview</h2>
          <Button size="sm" variant="secondary" data-testid="brief-preview-run" onClick={onPreview} disabled={busy === 'preview'}>
            {busy === 'preview' ? (
              <>
                <ThinkingOrb state="composing" size={20} /> Composing
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> Send a test
              </>
            )}
          </Button>
        </div>
        {preview ? (
          <pre
            data-testid="brief-preview-text"
            className="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-5 py-4 font-mono text-[12.5px] leading-relaxed text-fg-muted"
          >
            {briefToPlainText(preview)}
          </pre>
        ) : (
          <p className="text-[12.5px] text-fg-faint">
            Plain text, exactly what the channel delivers — no formatting or colour.
          </p>
        )}
      </section>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}
