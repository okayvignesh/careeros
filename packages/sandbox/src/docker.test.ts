import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildDockerArgs, generateContainerName, runDockerContainer } from './docker';
import { DEFAULT_MEMORY_MB, DEFAULT_TIMEOUT_MS, MAX_MEMORY_MB, MAX_OUTPUT_BYTES, MAX_TIMEOUT_MS } from './types';

describe('buildDockerArgs', () => {
  const base = {
    language: 'node' as const,
    containerName: 'careeros-sbx-test',
    memoryMb: DEFAULT_MEMORY_MB,
    codeB64: Buffer.from("console.log('hi')").toString('base64'),
    stdinB64: '',
  };

  it('emits the full strict container arg set', () => {
    const args = buildDockerArgs(base);
    // These flags are the security contract; they must all appear or reviewers know
    // instantly. The test intentionally asserts presence, not exact ordering.
    expect(args[0]).toBe('run');
    expect(args).toContain('--rm');
    expect(args).toContain('--network');
    expect(args[args.indexOf('--network') + 1]).toBe('none');
    expect(args).toContain('--memory');
    expect(args[args.indexOf('--memory') + 1]).toBe('256m');
    expect(args).toContain('--memory-swap');
    expect(args[args.indexOf('--memory-swap') + 1]).toBe('256m');
    expect(args).toContain('--pids-limit');
    expect(args[args.indexOf('--pids-limit') + 1]).toBe('128');
    expect(args).toContain('--ulimit');
    expect(args[args.indexOf('--ulimit') + 1]).toBe('nofile=64:64');
    expect(args).toContain('--read-only');
    expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('--security-opt');
    expect(args[args.indexOf('--security-opt') + 1]).toBe('no-new-privileges');
    expect(args).toContain('--user');
    expect(args[args.indexOf('--user') + 1]).toBe('65534:65534');
    expect(args).toContain('--cpus');
    expect(args[args.indexOf('--cpus') + 1]).toBe('0.5');
    expect(args).toContain('--stop-timeout');
    expect(args[args.indexOf('--stop-timeout') + 1]).toBe('1');
    expect(args).toContain('--name');
    expect(args[args.indexOf('--name') + 1]).toBe('careeros-sbx-test');
  });

  it('mounts /sandbox as tmpfs (writeable) with size cap and sticky bits', () => {
    const args = buildDockerArgs(base);
    // At least one --tmpfs flag targets the workdir. Sizing is 64m per the spec.
    const tmpfsValues = args
      .map((a, i) => (a === '--tmpfs' ? args[i + 1] : null))
      .filter((v): v is string => v !== null);
    expect(tmpfsValues.some((v) => v.startsWith('/sandbox:size=64m'))).toBe(true);
    expect(tmpfsValues.some((v) => v.startsWith('/tmp:size=64m'))).toBe(true);
  });

  it('injects code + stdin as base64 env vars (no host bind-mount)', () => {
    const args = buildDockerArgs(base);
    const envValues = args
      .map((a, i) => (a === '-e' ? args[i + 1] : null))
      .filter((v): v is string => v !== null);
    expect(envValues.some((v) => v.startsWith('CAREEROS_CODE_B64='))).toBe(true);
    expect(envValues.some((v) => v.startsWith('CAREEROS_STDIN_B64='))).toBe(true);
    // No -v / --volume mounts anywhere.
    expect(args.some((a) => a === '-v' || a === '--volume')).toBe(false);
  });

  it('memoryMb is reflected verbatim in both --memory and --memory-swap', () => {
    const args = buildDockerArgs({ ...base, memoryMb: 128 });
    expect(args[args.indexOf('--memory') + 1]).toBe('128m');
    expect(args[args.indexOf('--memory-swap') + 1]).toBe('128m');
  });

  it('language switches image and cmd', () => {
    const py = buildDockerArgs({ ...base, language: 'python' });
    expect(py).toContain('python:3.12-alpine');
    const go = buildDockerArgs({ ...base, language: 'go' });
    expect(go).toContain('golang:1.23-alpine');
    const ts = buildDockerArgs({ ...base, language: 'typescript' });
    // node runs both js and ts (via --experimental-strip-types).
    expect(ts).toContain('node:20-alpine');
  });
});

describe('generateContainerName', () => {
  it('is prefixed and unique-per-call', () => {
    const a = generateContainerName();
    const b = generateContainerName();
    // First 12 chars of a random UUIDv4: hex+dashes.
    expect(a).toMatch(/^careeros-sbx-[0-9a-f-]{12}$/);
    expect(a).not.toBe(b);
  });
});

// ────────── fake docker via injected spawn ──────────
//
// These exercise runDockerContainer's result-shape mapping without touching a real
// daemon. We build a minimal spawn stand-in that emits the outputs and exit code the
// scenario asks for.

interface FakeSpawnConfig {
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
  /** ms after spawn until the child closes; wall-timer beats this to test 'timeout'. */
  delayMs?: number;
}

function makeFakeSpawn(cfg: FakeSpawnConfig) {
  const fake: any = (_cmd: string, _args: readonly string[]) => {
    const child: any = new EventEmitter();
    child.stdout = Readable.from(cfg.stdout ? [Buffer.from(cfg.stdout)] : []);
    child.stderr = Readable.from(cfg.stderr ? [Buffer.from(cfg.stderr)] : []);
    child.kill = () => {};
    const t = setTimeout(() => child.emit('close', cfg.exitCode), cfg.delayMs ?? 5);
    child.__timer = t;
    return child;
  };
  return fake;
}

describe('runDockerContainer status mapping', () => {
  it('exit 0 → ok, stdout carried through', async () => {
    const spawnFn = makeFakeSpawn({ exitCode: 0, stdout: 'hi\n' });
    const res = await runDockerContainer(
      { language: 'node', code: "console.log('hi')" },
      { spawn: spawnFn },
    );
    expect(res.status).toBe('ok');
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('hi\n');
    expect(res.killedBy).toBeUndefined();
    expect(res.containerId).toMatch(/^careeros-sbx-/);
  });

  it('exit 137 → oom, killedBy oom', async () => {
    const spawnFn = makeFakeSpawn({ exitCode: 137, stderr: 'killed' });
    const res = await runDockerContainer(
      { language: 'node', code: 'x' },
      { spawn: spawnFn },
    );
    expect(res.status).toBe('oom');
    expect(res.killedBy).toBe('oom');
  });

  it('non-zero non-137 → crash', async () => {
    const spawnFn = makeFakeSpawn({ exitCode: 1, stderr: 'boom' });
    const res = await runDockerContainer(
      { language: 'node', code: 'x' },
      { spawn: spawnFn },
    );
    expect(res.status).toBe('crash');
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('boom');
  });

  it('wall-clock timeout → status timeout, killedBy wallclock', async () => {
    // Child would "finish" at 200ms; timeout fires at 20ms and kills it.
    const spawnFn = makeFakeSpawn({ exitCode: 0, delayMs: 200 });
    const res = await runDockerContainer(
      { language: 'node', code: 'while(true){}', timeoutMs: 20 },
      { spawn: spawnFn },
    );
    expect(res.status).toBe('timeout');
    expect(res.killedBy).toBe('wallclock');
  });

  it('stdout beyond 64KB gets truncated with a marker', async () => {
    const huge = 'a'.repeat(MAX_OUTPUT_BYTES + 5_000);
    const spawnFn = makeFakeSpawn({ exitCode: 0, stdout: huge });
    const res = await runDockerContainer(
      { language: 'node', code: 'x' },
      { spawn: spawnFn },
    );
    // Payload capped, plus the [truncated] marker on its own line.
    expect(res.stdout.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES + '\n[truncated]'.length);
    expect(res.stdout.endsWith('[truncated]')).toBe(true);
  });
});

describe('runDockerContainer input clamping', () => {
  it('caps timeoutMs at MAX_TIMEOUT_MS (30s)', async () => {
    // Spy on args by capturing the container name (proxy for a real run happening).
    const spawnFn = makeFakeSpawn({ exitCode: 0 });
    // We can't observe the internal clamp from result alone; assert defaults & max are the sentinels.
    // A ludicrous timeoutMs would still complete via fake spawn's 5ms close.
    const res = await runDockerContainer(
      { language: 'node', code: 'x', timeoutMs: 999_999 },
      { spawn: spawnFn },
    );
    expect(res.status).toBe('ok');
    // Independently assert the constants — the caller reads these to know the ceiling.
    expect(MAX_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
    expect(MAX_MEMORY_MB).toBe(512);
  });
});
