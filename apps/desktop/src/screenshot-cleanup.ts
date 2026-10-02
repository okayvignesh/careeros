/**
 * D.8 screenshot retention. Task-runner screenshots live under
 * `userData/screenshots/` (per phase-3.5 spec); files older than 30 days are
 * purged. One pass on app start + a daily tick after that.
 *
 * ponytail: scheduled on a fixed 24h setInterval, not a cron with
 * drift-free scheduling. If the laptop sleeps through the tick, the next
 * boot catches up. If retention needs to be shorter than 1 day, swap for
 * a chokidar watcher on the dir.
 *
 * ponytail: mtime-based retention (filesystem age), not a sidecar JSON
 * index. Simpler + works for every write path. Breaks if someone `touch`es
 * the files, that's a non-threat for a per-user agent.
 */

import { promises as fs, type Dirent } from 'node:fs';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;

export interface CleanupOptions {
  dir: string;
  retentionDays?: number;
  now?: () => number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface CleanupResult {
  scanned: number;
  deleted: number;
  errors: number;
}

/**
 * Walk `dir` recursively, unlink every regular file whose mtime is older
 * than `retentionDays`. Returns counts for logging. Missing dir is not an
 * error (nothing to clean up yet).
 */
export async function runCleanupPass(opts: CleanupOptions): Promise<CleanupResult> {
  const log = opts.logger ?? console;
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = (opts.now?.() ?? Date.now()) - retentionDays * DAY_MS;
  const result: CleanupResult = { scanned: 0, deleted: 0, errors: 0 };

  let entries: Dirent[];
  try {
    entries = (await fs.readdir(opts.dir, { withFileTypes: true })) as unknown as Dirent[];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return result;
    log.warn(`screenshot-cleanup: readdir failed (${(err as Error).message})`);
    result.errors += 1;
    return result;
  }

  for (const entry of entries) {
    const full = join(opts.dir, entry.name);
    if (entry.isDirectory()) {
      // Recurse so YYYY-MM/ subdirs (per phase-3.5 spec) get cleaned too.
      const nested = await runCleanupPass({ ...opts, dir: full });
      result.scanned += nested.scanned;
      result.deleted += nested.deleted;
      result.errors += nested.errors;
      continue;
    }
    if (!entry.isFile()) continue;
    result.scanned += 1;
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(full);
        result.deleted += 1;
      }
    } catch (err) {
      log.warn(`screenshot-cleanup: ${entry.name}: ${(err as Error).message}`);
      result.errors += 1;
    }
  }

  if (result.deleted > 0 || result.errors > 0) {
    log.info(
      `screenshot-cleanup: scanned=${result.scanned} deleted=${result.deleted} errors=${result.errors}`,
    );
  }
  return result;
}

export interface SchedulerOptions extends CleanupOptions {
  intervalMs?: number;
}

/**
 * Run one pass immediately, then re-run every `intervalMs` (default: 24h).
 * Returns a stop handle for shutdown.
 */
export function startCleanupScheduler(opts: SchedulerOptions): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? DAY_MS;
  void runCleanupPass(opts);
  const timer = setInterval(() => void runCleanupPass(opts), intervalMs);
  if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
  return { stop: () => clearInterval(timer) };
}
