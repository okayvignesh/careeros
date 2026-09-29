import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E.3 (Wave E / P5): daily-brief preferences.
 *
 * One row per user. Absence = not configured = opted-out. Callers upsert
 * to enable + set timezone + send hour + delivery channels; disable via
 * `setEnabled(userId, false)`; snooze via `snooze(userId, days)`.
 *
 * `timezone` is validated by asking JS to build an Intl.DateTimeFormat
 * with it - if it throws, the tz is invalid. Cheap, correct, no deps.
 * `sendHourLocal` is 0-23 (DB check constraint enforces the bound too).
 *
 * ponytail: no lookup table for allowed channels. The @careeros/messaging
 * ChannelRegistry rejects unknown kinds at send time; forbidding them here
 * would duplicate the taxonomy and drift.
 */

export interface UpsertPreferencesInput {
  timezone?: string;
  sendHourLocal?: number;
  channels?: string[];
}

export interface Preferences {
  userId: string;
  isEnabled: boolean;
  timezone: string;
  sendHourLocal: number;
  channels: string[];
  snoozedUntil: Date | null;
  lastSentAt: Date | null;
}

@Injectable()
export class DailyBriefPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<Preferences | null> {
    const row = await this.prisma.dailyBriefPreference.findUnique({ where: { userId } });
    return row ? toPreferences(row) : null;
  }

  async upsert(userId: string, input: UpsertPreferencesInput): Promise<Preferences> {
    const timezone = input.timezone ?? 'UTC';
    validateTimezone(timezone);
    const hour = input.sendHourLocal ?? 8;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new BadRequestException('sendHourLocal must be an integer 0-23');
    }
    const channels = input.channels ?? ['web'];
    if (!Array.isArray(channels) || channels.some((c) => typeof c !== 'string')) {
      throw new BadRequestException('channels must be a string[]');
    }
    const row = await this.prisma.dailyBriefPreference.upsert({
      where: { userId },
      create: {
        userId,
        timezone,
        sendHourLocal: hour,
        channels,
        isEnabled: true,
      },
      update: {
        timezone,
        sendHourLocal: hour,
        channels,
      },
    });
    return toPreferences(row);
  }

  async setEnabled(userId: string, isEnabled: boolean): Promise<Preferences> {
    const row = await this.prisma.dailyBriefPreference.upsert({
      where: { userId },
      create: { userId, isEnabled },
      update: { isEnabled },
    });
    return toPreferences(row);
  }

  /**
   * Snooze the brief for N days. `days=0` clears the snooze. Max 30 to
   * avoid an "I forgot I had a snooze on" indefinite-mute scenario.
   */
  async snooze(userId: string, days: number): Promise<Preferences> {
    if (!Number.isFinite(days) || days < 0 || days > 30) {
      throw new BadRequestException('snooze days must be 0-30');
    }
    const snoozedUntil = days === 0 ? null : new Date(Date.now() + days * 86_400_000);
    const row = await this.prisma.dailyBriefPreference.upsert({
      where: { userId },
      create: { userId, snoozedUntil },
      update: { snoozedUntil },
    });
    return toPreferences(row);
  }

  async markSent(userId: string, at: Date = new Date()): Promise<void> {
    await this.prisma.dailyBriefPreference.update({
      where: { userId },
      data: { lastSentAt: at },
    });
  }

  /**
   * All users whose preferences say the brief should fire at some point:
   * `isEnabled = true` AND (`snoozedUntil` null OR in the past). The
   * scheduler enqueues one delayed job per row on boot + on any pref
   * change; the "in the past" check gates a snoozed user re-entering the
   * schedule after their snooze ends.
   */
  async listActive(): Promise<Preferences[]> {
    const rows = await this.prisma.dailyBriefPreference.findMany({
      where: {
        isEnabled: true,
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
      },
    });
    return rows.map(toPreferences);
  }
}

function toPreferences(row: {
  userId: string;
  isEnabled: boolean;
  timezone: string;
  sendHourLocal: number;
  channels: string[];
  snoozedUntil: Date | null;
  lastSentAt: Date | null;
}): Preferences {
  return {
    userId: row.userId,
    isEnabled: row.isEnabled,
    timezone: row.timezone,
    sendHourLocal: row.sendHourLocal,
    channels: [...row.channels],
    snoozedUntil: row.snoozedUntil,
    lastSentAt: row.lastSentAt,
  };
}

/**
 * Cheap timezone validation via Intl.DateTimeFormat: any string the JS
 * engine accepts is a valid IANA identifier for our purposes. Throws
 * BadRequestException on invalid input.
 */
export function validateTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new BadRequestException(`invalid timezone: ${tz}`);
  }
}

/**
 * Compute the next-firing UTC instant for a given tz + local hour. Public
 * because the scheduler + tests both call it. If `after` is already past
 * today's send hour in that tz, returns tomorrow's; otherwise today's.
 *
 * Implementation notes:
 *   - Use `Intl.DateTimeFormat.formatToParts` with the target timezone to
 *     extract the wall-clock components of `after` in that tz.
 *   - Delta = hoursToTarget from those components; add + 24h if delta <= 0.
 *   - Return `after + delta` in UTC. Handles DST correctly because the
 *     wall-clock extraction is the DST-aware step.
 */
export function nextFiringAt(tz: string, hourLocal: number, after: Date = new Date()): Date {
  validateTimezone(tz);
  if (!Number.isInteger(hourLocal) || hourLocal < 0 || hourLocal > 23) {
    throw new Error('hourLocal must be integer 0-23');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(after);
  const partMap: Record<string, string> = {};
  for (const p of parts) partMap[p.type] = p.value;
  const nowH = Number(partMap.hour ?? '0');
  const nowM = Number(partMap.minute ?? '0');
  const nowS = Number(partMap.second ?? '0');
  const nowSecInDay = nowH * 3600 + nowM * 60 + nowS;
  const targetSec = hourLocal * 3600;
  let deltaSec = targetSec - nowSecInDay;
  if (deltaSec <= 0) deltaSec += 86_400;
  return new Date(after.getTime() + deltaSec * 1000);
}
