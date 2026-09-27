import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetKillSwitchCacheForTests,
  getPausedFilePath,
  isSandboxPaused,
  pauseSandbox,
  resumeSandbox,
} from './kill-switch';

// The kill-switch persists to a file so admin `POST /admin/sandbox/pause` survives an
// api restart. Tests use SANDBOX_PAUSED_FILE to redirect the flag file into a per-test
// tmpdir so we never touch /var/run/careeros on the dev box.

describe('kill-switch (file-persisted)', () => {
  let dir: string;
  let flagPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'careeros-sbx-ks-'));
    flagPath = join(dir, 'sandbox.paused');
    prev = process.env.SANDBOX_PAUSED_FILE;
    process.env.SANDBOX_PAUSED_FILE = flagPath;
    __resetKillSwitchCacheForTests();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.SANDBOX_PAUSED_FILE;
    else process.env.SANDBOX_PAUSED_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
    __resetKillSwitchCacheForTests();
  });

  it('defaults to not paused when the file does not exist', () => {
    expect(getPausedFilePath()).toBe(flagPath);
    expect(existsSync(flagPath)).toBe(false);
    expect(isSandboxPaused()).toBe(false);
  });

  it('pauseSandbox writes the flag and isSandboxPaused reports true', () => {
    pauseSandbox();
    expect(existsSync(flagPath)).toBe(true);
    expect(isSandboxPaused()).toBe(true);
  });

  it('resumeSandbox removes the flag and isSandboxPaused reports false', () => {
    pauseSandbox();
    expect(isSandboxPaused()).toBe(true);
    resumeSandbox();
    expect(existsSync(flagPath)).toBe(false);
    expect(isSandboxPaused()).toBe(false);
  });

  it('resumeSandbox on a missing file is a no-op (idempotent)', () => {
    expect(() => resumeSandbox()).not.toThrow();
    expect(isSandboxPaused()).toBe(false);
  });

  it('picks up out-of-band pause (operator touched the file directly) after cache TTL', async () => {
    // Fresh state after cache reset in beforeEach — first call goes to disk.
    expect(isSandboxPaused()).toBe(false);
    // Write flag directly (simulating operator `touch`).
    require('node:fs').writeFileSync(flagPath, '');
    // Cache is 1s TTL; force it stale.
    __resetKillSwitchCacheForTests();
    expect(isSandboxPaused()).toBe(true);
  });
});
