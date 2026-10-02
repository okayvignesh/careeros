/**
 * D.8 log rotation. The in-app log file lives under `app.getPath('logs')`
 * (Electron's standard logs dir). Rotated when it crosses 10 MB OR when the
 * current `.log` is 14 days old, whichever first. Rotation is a simple
 * rename chain: `agent.log` -> `agent.log.1` -> `agent.log.2` -> ... with
 * the oldest beyond `keep` dropped.
 *
 * ponytail: no gzip on rotated files. Rotated logs stay plain text so
 * `grep` / `less` still work without a decompress step. Add gzip when a
 * user's keep ring breaches disk budget.
 *
 * ponytail: rotation is a cron-style check, not a stream wrapper. Logs
 * past the cap keep growing between checks (default: 1h tick). The spec
 * only asks for retention + size cap, not real-time rotation.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_KEEP = 5;

export interface RotationOptions {
  dir: string;
  file?: string;
  maxBytes?: number;
  retentionDays?: number;
  keep?: number;
  now?: () => number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface RotationResult {
  rotated: boolean;
  reason: 'size' | 'age' | null;
  droppedOldest: boolean;
}

/**
 * Decide whether the current log needs rotating. Pure for tests.
 */
export function shouldRotate(
  stat: { size: number; mtimeMs: number } | null,
  nowMs: number,
  maxBytes: number,
  retentionDays: number,
): RotationResult['reason'] {
  if (!stat) return null;
  if (stat.size >= maxBytes) return 'size';
  if (nowMs - stat.mtimeMs >= retentionDays * DAY_MS) return 'age';
  return null;
}

/**
 * One rotation pass. If `agent.log` triggers either rule, bump the chain:
 * `.log.(keep-1)` is unlinked, `.log.(n)` -> `.log.(n+1)` down to
 * `.log` -> `.log.1`, and a fresh empty `.log` is left behind.
 */
export async function runRotationPass(opts: RotationOptions): Promise<RotationResult> {
  const log = opts.logger ?? console;
  const file = opts.file ?? 'agent.log';
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const keep = Math.max(1, opts.keep ?? DEFAULT_KEEP);
  const now = opts.now?.() ?? Date.now();
  const base = join(opts.dir, file);

  let stat: { size: number; mtimeMs: number } | null = null;
  try {
    const s = await fs.stat(base);
    stat = { size: s.size, mtimeMs: s.mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { rotated: false, reason: null, droppedOldest: false };
    }
    throw err;
  }

  const reason = shouldRotate(stat, now, maxBytes, retentionDays);
  if (!reason) return { rotated: false, reason: null, droppedOldest: false };

  // Drop the oldest if the ring would overflow.
  const oldest = `${base}.${keep}`;
  let droppedOldest = false;
  try {
    await fs.unlink(oldest);
    droppedOldest = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`log-rotation: unlink ${oldest}: ${(err as Error).message}`);
    }
  }

  // Walk down the chain so .log.N -> .log.(N+1) without clobbering.
  for (let i = keep - 1; i >= 1; i -= 1) {
    const src = `${base}.${i}`;
    const dst = `${base}.${i + 1}`;
    try {
      await fs.rename(src, dst);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(`log-rotation: rename ${src} -> ${dst}: ${(err as Error).message}`);
      }
    }
  }

  await fs.rename(base, `${base}.1`);
  // Leave an empty current log so the next writer appends cleanly.
  await fs.writeFile(base, '');
  log.info(`log-rotation: rotated ${file} (reason=${reason})`);
  return { rotated: true, reason, droppedOldest };
}

export interface SchedulerOptions extends RotationOptions {
  intervalMs?: number;
}

export function startRotationScheduler(opts: SchedulerOptions): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? HOUR_MS;
  const log = opts.logger ?? console;
  const safeRun = (): void => {
    runRotationPass(opts).catch((err: Error) => {
      log.warn(`log-rotation: pass failed (${err.message})`);
    });
  };
  safeRun();
  const timer = setInterval(safeRun, intervalMs);
  if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
  return { stop: () => clearInterval(timer) };
}
