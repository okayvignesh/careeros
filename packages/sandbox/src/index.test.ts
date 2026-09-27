import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isDockerAvailable,
  pauseSandbox,
  resumeSandbox,
  runSandboxed,
} from './index';
// Deep import solely to reset the module-scope cache after tests flip env.
import { __resetKillSwitchCacheForTests as resetCache } from './kill-switch';

describe('runSandboxed short-circuit when paused', () => {
  let dir: string;
  let prev: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'careeros-sbx-idx-'));
    prev = process.env.SANDBOX_PAUSED_FILE;
    process.env.SANDBOX_PAUSED_FILE = join(dir, 'sandbox.paused');
    resetCache();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SANDBOX_PAUSED_FILE;
    else process.env.SANDBOX_PAUSED_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
    resetCache();
  });

  it('returns { status: "paused", killedBy: "operator" } without touching docker', async () => {
    pauseSandbox();
    const res = await runSandboxed({ language: 'node', code: 'console.log(1)' });
    expect(res.status).toBe('paused');
    expect(res.killedBy).toBe('operator');
    expect(res.containerId).toBe('');
    expect(res.exitCode).toBeNull();
    expect(res.wallTimeMs).toBe(0);
    resumeSandbox();
  });
});

// Real docker E2E — opt-in via SANDBOX_E2E=1 AND requires docker locally.
// Skipped in almost every CI unless a runner explicitly opts in.
const runE2E = process.env.SANDBOX_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

maybe('E2E: real docker (opt-in via SANDBOX_E2E=1)', () => {
  it("node: console.log('hi') → stdout 'hi', exit 0, status ok", async () => {
    const res = await runSandboxed({
      language: 'node',
      code: "console.log('hi')",
      timeoutMs: 15_000,
    });
    expect(res.status).toBe('ok');
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('hi');
    expect(res.containerId).toMatch(/^careeros-sbx-/);
    expect(res.killedBy).toBeUndefined();
  }, 60_000);
}, 60_000);
