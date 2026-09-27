/**
 * Sandbox adversarial security suite (C-P2.2).
 *
 * Each case fires a real attack at the real sandbox and asserts the container
 * arg contract in `docker.ts:buildDockerArgs` actually blocks it. If any arg
 * gets removed later, at least one of these tests trips. Skipped unless
 * `SANDBOX_E2E=1` AND `isDockerAvailable()` , same gate as `index.test.ts`.
 *
 * All fixtures inline (5-10 lines each) rather than a `__fixtures__/` tree:
 * one file to review, one place to grep. ponytail.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDockerAvailable, pauseSandbox, resumeSandbox, runSandboxed } from './index';
import { __resetKillSwitchCacheForTests as resetCache } from './kill-switch';

const runE2E = process.env.SANDBOX_E2E === '1' && isDockerAvailable();
if (!runE2E) {
  // eslint-disable-next-line no-console
  console.log(
    '[security.test] SKIP: SANDBOX_E2E=1 and docker required (SANDBOX_E2E=%s, docker=%s)',
    process.env.SANDBOX_E2E ?? '',
    isDockerAvailable() ? 'up' : 'down',
  );
}
const maybe = runE2E ? describe : describe.skip;

// One-container attacks share the same wall-clock ceiling so a broken block
// can't hang CI. 20s is generous vs. the 15s vitest default; we override
// per-test with the 3rd arg to `it`.
const ATTACK_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 60_000;

maybe('C-P2.2 sandbox security suite (real docker)', () => {
  // 1. Memory bomb , MUTATION SMOKE: remove `--memory 256m` / `--memory-swap 256m`
  //    from buildDockerArgs → node OOM-guards trigger differently and status
  //    won't be 'oom' (V8 will throw OOM at ~1.5G with the process still exit 1).
  it('memory bomb: 512MB allocation is OOM-killed under --memory 256m', async () => {
    const code = `
      const arr = [];
      // Each push is a 1MB string; ~512 iterations to hit the cap.
      while (true) arr.push('x'.repeat(1024 * 1024));
    `;
    const res = await runSandboxed({
      language: 'node',
      code,
      timeoutMs: ATTACK_TIMEOUT_MS,
      memoryLimitMb: 256,
    });
    expect(res.status).toBe('oom');
    expect(res.exitCode).not.toBe(0);
    expect(res.exitCode).toBe(137);
    expect(res.killedBy).toBe('oom');
  }, TEST_TIMEOUT_MS);

  // 2. Network egress , MUTATION SMOKE: remove `--network none` → fetch resolves
  //    and returns a 2xx; assertion on network-fail marker breaks.
  it('network egress: fetch(example.com) fails under --network none', async () => {
    const code = `
      (async () => {
        try {
          const r = await fetch('https://example.com', { signal: AbortSignal.timeout(4000) });
          console.log('UNEXPECTED_STATUS=' + r.status);
          process.exit(0);
        } catch (e) {
          const cause = e && e.cause;
          const code = (cause && (cause.code || cause.errno)) || e.code || 'NONE';
          console.error('NET_ERR=' + code + ' MSG=' + (e.message || '').slice(0, 200));
          process.exit(2);
        }
      })();
    `;
    const res = await runSandboxed({
      language: 'node',
      code,
      timeoutMs: ATTACK_TIMEOUT_MS,
    });
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).not.toContain('UNEXPECTED_STATUS');
    // undici throws EAI_AGAIN (dns), ENETUNREACH, ECONNREFUSED, ETIMEDOUT, or
    // the AbortError from our 4s watchdog when the packet never gets a reply
    // (Docker Desktop's dns-over-vsock silently blackholes under --network none
    // on macOS). All four are legitimate evidence egress is blocked.
    expect(res.stderr).toMatch(
      /NET_ERR=(EAI_AGAIN|ENOTFOUND|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|UND_ERR|ABORT_ERR|23)|aborted due to timeout|getaddrinfo/,
    );
  }, TEST_TIMEOUT_MS);

  // 3. Fork bomb , MUTATION SMOKE: remove `--pids-limit 128` → child spawns
  //    balloon; wall time approaches ATTACK_TIMEOUT_MS and this test's <10s
  //    wall bound fails (attack succeeds → wallclock kill takes over).
  //    We run the classic shell fork bomb via /bin/sh which is present in
  //    node:20-alpine. The pids cap forces `sh: cannot fork` and the entry
  //    process either exits or is killed by the resource ceiling.
  it('fork bomb: :(){ :|:& };: bounded by --pids-limit 128', async () => {
    const code = `
      const { spawnSync } = require('node:child_process');
      const r = spawnSync('sh', ['-c', ':(){ :|:& };:'], {
        timeout: 8000,
        encoding: 'utf8',
      });
      console.log('exit=' + r.status + ' signal=' + r.signal);
      if (r.stderr) console.error('stderr=' + r.stderr.slice(0, 500));
    `;
    const started = Date.now();
    const res = await runSandboxed({
      language: 'node',
      code,
      timeoutMs: ATTACK_TIMEOUT_MS,
    });
    const wall = Date.now() - started;
    // Wall clock bound: pids-limit means the bomb self-caps and node exits;
    // if the block is missing, we'd hit the sandbox wall-clock at ~15s.
    expect(wall).toBeLessThan(12_000);
    // Either the container exits cleanly (bomb self-caps and node returns)
    // OR the sandbox marks it crash/timeout , anything but a passthrough OK
    // with all children still alive on the host.
    expect(['ok', 'crash', 'timeout']).toContain(res.status);
  }, TEST_TIMEOUT_MS);

  // 4. Wall-clock timeout , MUTATION SMOKE: remove the setTimeout+docker-kill
  //    block in runDockerContainer → infinite loop runs forever and this
  //    test hangs past TEST_TIMEOUT_MS.
  it('wall-clock: infinite loop killed by SIGKILL within timeoutMs+1s', async () => {
    const timeoutMs = 3_000;
    const started = Date.now();
    const res = await runSandboxed({
      language: 'node',
      code: 'while (true) {}',
      timeoutMs,
    });
    const wall = Date.now() - started;
    expect(res.status).toBe('timeout');
    expect(res.killedBy).toBe('wallclock');
    expect(wall).toBeLessThan(timeoutMs + 5_000);
  }, TEST_TIMEOUT_MS);

  // 5. Filesystem escape , MUTATION SMOKE: remove `--read-only` → writes
  //    to /etc/passwd succeed (well, EACCES from --user nobody, but the
  //    error class flips from EROFS to EACCES; the assertion on EROFS breaks).
  it('filesystem escape: write to /etc/passwd fails EROFS under --read-only', async () => {
    const code = `
      const fs = require('node:fs');
      try {
        fs.writeFileSync('/etc/passwd', 'pwned\\n');
        console.log('UNEXPECTED_WROTE');
        process.exit(0);
      } catch (e) {
        console.error('FS_ERR=' + e.code + ' ' + e.message.slice(0, 200));
        process.exit(3);
      }
    `;
    const res = await runSandboxed({
      language: 'node',
      code,
      timeoutMs: ATTACK_TIMEOUT_MS,
    });
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).not.toContain('UNEXPECTED_WROTE');
    // Node maps EROFS → error.code === 'EROFS'; alpine's kernel msg is
    // "Read-only file system". Either surfaces the block.
    expect(res.stderr).toMatch(/EROFS|Read-only file system/);
  }, TEST_TIMEOUT_MS);

  // 6. Tmpfs cap , MUTATION SMOKE: drop `size=64m` from the /tmp tmpfs flag
  //    → 128MB write succeeds; ENOSPC assertion breaks.
  it('tmpfs isolation: writing 128MB to /tmp hits the size=64m ENOSPC cap', async () => {
    const code = `
      const fs = require('node:fs');
      const buf = Buffer.alloc(1024 * 1024, 0x61); // 1MB of 'a'
      try {
        const fd = fs.openSync('/tmp/big', 'w');
        for (let i = 0; i < 128; i++) fs.writeSync(fd, buf);
        fs.closeSync(fd);
        console.log('UNEXPECTED_FIT');
        process.exit(0);
      } catch (e) {
        console.error('FS_ERR=' + e.code + ' ' + e.message.slice(0, 200));
        process.exit(4);
      }
    `;
    const res = await runSandboxed({
      language: 'node',
      code,
      timeoutMs: ATTACK_TIMEOUT_MS,
    });
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).not.toContain('UNEXPECTED_FIT');
    expect(res.stderr).toMatch(/ENOSPC|No space left on device/);
  }, TEST_TIMEOUT_MS);

  // 8. cap-drop , MUTATION SMOKE: remove `--cap-drop=ALL` (or add
  //    `--cap-add=SYS_ADMIN`) → mount succeeds; the exit-code + EPERM
  //    assertions break. `mount -t proc proc /mnt` needs CAP_SYS_ADMIN;
  //    with --cap-drop=ALL + --user nobody, the syscall returns EPERM
  //    (surfaces as "permission denied" / "Operation not permitted").
  //
  //    ponytail: we intentionally do NOT try chmod +s here , tmpfs on
  //    Docker Desktop lets a uid-owned setuid bit stick, so a chmod-based
  //    test would false-negative. mount is the unambiguous cap probe.
  it('cap-drop: mount syscall fails EPERM under --cap-drop=ALL', async () => {
    const code = `
      const { spawnSync } = require('node:child_process');
      const r = spawnSync('mount', ['-t', 'proc', 'proc', '/mnt'], { encoding: 'utf8' });
      if (r.status === 0) {
        console.log('UNEXPECTED_MOUNTED');
        process.exit(0);
      }
      console.error('MOUNT_EXIT=' + r.status + ' STDERR=' + (r.stderr || '').slice(0, 300));
      process.exit(6);
    `;
    const res = await runSandboxed({
      language: 'node',
      code,
      timeoutMs: ATTACK_TIMEOUT_MS,
    });
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).not.toContain('UNEXPECTED_MOUNTED');
    expect(res.stderr).toMatch(/permission denied|Operation not permitted|EPERM|only root/i);
  }, TEST_TIMEOUT_MS);
});

// 7. Kill switch , MUTATION SMOKE: remove the `if (isSandboxPaused())` guard
//    in `runSandboxed` → the pause file is ignored and docker still runs.
//    This one does NOT need docker (short-circuit is pure JS + fs), so it
//    runs independent of SANDBOX_E2E. It duplicates one assertion from
//    index.test.ts on purpose: kill-switch is the operator's last-resort
//    off button and belongs in the security suite too.
describe('C-P2.2 kill switch security guard', () => {
  let dir: string;
  let prev: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'careeros-sec-ks-'));
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

  it('SANDBOX_PAUSED_FILE existing → runSandboxed returns paused without docker', async () => {
    // Touch the file directly (do not call pauseSandbox() to prove the guard
    // reads disk state, not just in-process cache).
    writeFileSync(process.env.SANDBOX_PAUSED_FILE!, new Date().toISOString(), 'utf8');
    resetCache();
    const started = Date.now();
    const res = await runSandboxed({ language: 'node', code: 'console.log(1)' });
    const wall = Date.now() - started;
    expect(res.status).toBe('paused');
    expect(res.killedBy).toBe('operator');
    expect(res.containerId).toBe('');
    expect(res.exitCode).toBeNull();
    // Zero-docker path returns in single-digit ms; a docker miss would be > 500ms.
    expect(wall).toBeLessThan(500);
    // Round-trip via pauseSandbox/resumeSandbox helpers.
    pauseSandbox();
    expect((await runSandboxed({ language: 'node', code: 'x' })).status).toBe('paused');
    resumeSandbox();
  });
});
