import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Kill-switch persistence via a flag file (default `/var/run/careeros/sandbox.paused`).
 * File presence = paused. Chosen over a DB row so the check is a single fs.exists on
 * every run start with no dependency on Prisma / a live connection, and so the state
 * survives api restarts without any migration.
 *
 * Override for tests via `SANDBOX_PAUSED_FILE`.
 *
 * ponytail: process-local cache saves a stat() on every hot-path call; refreshed on
 * every pause/resume and re-read from disk when `isSandboxPaused()` sees the cache is
 * stale (single ttl). If the operator ever pauses out-of-band by touching the file
 * directly, we pick it up on the next check.
 */
const DEFAULT_PATH = '/var/run/careeros/sandbox.paused';
const CACHE_TTL_MS = 1_000;

let cachedPaused: boolean | null = null;
let cachedAt = 0;

export function getPausedFilePath(): string {
  return process.env.SANDBOX_PAUSED_FILE ?? DEFAULT_PATH;
}

export function pauseSandbox(): void {
  const p = getPausedFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, new Date().toISOString(), 'utf8');
  cachedPaused = true;
  cachedAt = Date.now();
}

export function resumeSandbox(): void {
  const p = getPausedFilePath();
  try {
    rmSync(p, { force: true });
  } catch {
    // ponytail: rmSync with force:true doesn't throw on missing file; keep the catch
    // for the rare EPERM case where /var/run/careeros is unwriteable by our uid.
  }
  cachedPaused = false;
  cachedAt = Date.now();
}

export function isSandboxPaused(): boolean {
  const now = Date.now();
  if (cachedPaused !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedPaused;
  }
  const paused = existsSync(getPausedFilePath());
  cachedPaused = paused;
  cachedAt = now;
  return paused;
}

/** For tests. */
export function __resetKillSwitchCacheForTests(): void {
  cachedPaused = null;
  cachedAt = 0;
}
