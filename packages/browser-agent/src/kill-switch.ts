import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * File-based kill switch mirroring `@careeros/sandbox` kill-switch (C-P2.1
 * pattern). File presence = paused; check is a single fs.exists on every
 * task dispatch, cached for 1s so we don't stat() on every hot-path call.
 *
 * Default path: `/var/run/careeros/agent.paused`. Override via
 * `AGENT_PAUSED_FILE` (used in tests + operators who want a different mount).
 */

const DEFAULT_PATH = '/var/run/careeros/agent.paused';
const CACHE_TTL_MS = 1_000;

let cachedPaused: boolean | null = null;
let cachedAt = 0;

export function getPausedFilePath(): string {
  return process.env.AGENT_PAUSED_FILE ?? DEFAULT_PATH;
}

export function pauseAgent(): void {
  const p = getPausedFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, new Date().toISOString(), 'utf8');
  cachedPaused = true;
  cachedAt = Date.now();
}

export function resumeAgent(): void {
  const p = getPausedFilePath();
  try {
    rmSync(p, { force: true });
  } catch {
    // ponytail: rmSync with force:true doesn't throw on ENOENT; catch only
    // the rare EPERM case where the dir is unwriteable by our uid.
  }
  cachedPaused = false;
  cachedAt = Date.now();
}

export function isAgentPaused(): boolean {
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
