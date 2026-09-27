import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getLanguageConfig } from './languages';
import {
  DEFAULT_MEMORY_MB,
  DEFAULT_TIMEOUT_MS,
  MAX_MEMORY_MB,
  MAX_OUTPUT_BYTES,
  MAX_TIMEOUT_MS,
  type KilledBy,
  type RunOptions,
  type SandboxResult,
  type SandboxStatus,
} from './types';

/**
 * Build the `docker run` argv for one attempt. Exported so the args are unit-testable
 * without shelling out. The container is fully sealed:
 *
 *   --rm                          auto-cleanup on exit
 *   --network none                zero egress; deps must be baked into the image
 *   --memory / --memory-swap      hard OOM cap, swap disabled so `--oom-kill-disable`
 *                                 semantics are simple: exceeded → SIGKILL → exit 137
 *   --pids-limit 128              blocks fork bombs
 *   --ulimit nofile=64:64         cap open files
 *   --read-only                   root filesystem is immutable
 *   --tmpfs /sandbox              writeable ONLY here; capped size
 *   --cap-drop=ALL                strip every Linux capability
 *   --security-opt no-new-privs   no setuid escalation
 *   --user 65534:65534            nobody:nogroup
 *   --cpus 0.5                    half a core
 *   --stop-timeout 1              docker's own graceful shutdown grace (belt-and-suspenders;
 *                                 the wall-clock SIGKILL is the primary enforcement)
 *
 * The code and stdin are shipped via env vars (base64 to preserve bytes); a tiny sh
 * wrapper decodes them into tmpfs before exec-ing the language runtime. That keeps the
 * whole run to a single `docker run` invocation.
 */
export function buildDockerArgs(opts: {
  language: RunOptions['language'];
  containerName: string;
  memoryMb: number;
  codeB64: string;
  stdinB64: string;
}): string[] {
  const cfg = getLanguageConfig(opts.language);
  const mem = `${opts.memoryMb}m`;
  const decodeAndRun =
    `set -e; ` +
    `printf '%s' "$CAREEROS_CODE_B64" | base64 -d > ${cfg.workdir}/${cfg.entrypoint}; ` +
    `printf '%s' "$CAREEROS_STDIN_B64" | base64 -d > ${cfg.workdir}/.stdin; ` +
    `exec ${cfg.cmd.map(shellQuote).join(' ')} < ${cfg.workdir}/.stdin`;

  return [
    'run',
    '--rm',
    '-i',
    '--name', opts.containerName,
    '--network', 'none',
    '--memory', mem,
    '--memory-swap', mem,
    '--pids-limit', '128',
    '--ulimit', 'nofile=64:64',
    '--read-only',
    '--tmpfs', `${cfg.workdir}:size=64m,mode=1777`,
    '--tmpfs', '/tmp:size=64m,mode=1777',
    '--cap-drop=ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '65534:65534',
    '--cpus', '0.5',
    '--stop-timeout', '1',
    '--workdir', cfg.workdir,
    '-e', `CAREEROS_CODE_B64=${opts.codeB64}`,
    '-e', `CAREEROS_STDIN_B64=${opts.stdinB64}`,
    cfg.image,
    'sh', '-c', decodeAndRun,
  ];
}

// Only single quotes need escaping; everything else in an argv slot is safe. We double-
// quote for shell-eval since the string is passed to `sh -c`, and we want $VAR to expand.
function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-\/.=:]+$/.test(s)) return s;
  return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

export function generateContainerName(): string {
  return `careeros-sbx-${randomUUID().slice(0, 12)}`;
}

/**
 * Detect whether Docker is usable in the current process. `docker info` fails when
 * the daemon isn't reachable (no daemon, socket perms, colima not up, CI without
 * DIND). Tests use this to skip container-dependent cases cleanly.
 */
export function isDockerAvailable(): boolean {
  try {
    const which = spawnSync('sh', ['-c', 'command -v docker'], { encoding: 'utf8' });
    if (which.status !== 0) return false;
    const info = spawnSync('docker', ['info'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return info.status === 0;
  } catch {
    return false;
  }
}

interface RunDockerDeps {
  /** Injected for tests; production calls `child_process.spawn`. */
  spawn?: typeof spawn;
  now?: () => number;
}

/**
 * Runs a single container end-to-end. Applies the wall-clock deadline (SIGKILL on
 * timeout), enforces the output cap, and maps docker exit signals to sandbox status.
 */
export async function runDockerContainer(
  opts: RunOptions,
  deps: RunDockerDeps = {},
): Promise<SandboxResult> {
  const spawnFn = deps.spawn ?? spawn;
  const now = deps.now ?? (() => Date.now());

  const timeoutMs = Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const memoryMb = Math.min(opts.memoryLimitMb ?? DEFAULT_MEMORY_MB, MAX_MEMORY_MB);
  const containerName = generateContainerName();

  const codeB64 = Buffer.from(opts.code, 'utf8').toString('base64');
  const stdinB64 = Buffer.from(opts.stdin ?? '', 'utf8').toString('base64');
  const args = buildDockerArgs({
    language: opts.language,
    containerName,
    memoryMb,
    codeB64,
    stdinB64,
  });

  const startedAt = now();
  const child = spawnFn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  let stdoutTruncated = false;
  let stderrTruncated = false;
  const appendCapped = (which: 'out' | 'err', chunk: Buffer) => {
    if (which === 'out') {
      if (stdoutTruncated) return;
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(stdout, 'utf8');
      if (chunk.length <= remaining) {
        stdout += chunk.toString('utf8');
      } else {
        stdout += chunk.subarray(0, Math.max(0, remaining)).toString('utf8');
        stdoutTruncated = true;
      }
    } else {
      if (stderrTruncated) return;
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(stderr, 'utf8');
      if (chunk.length <= remaining) {
        stderr += chunk.toString('utf8');
      } else {
        stderr += chunk.subarray(0, Math.max(0, remaining)).toString('utf8');
        stderrTruncated = true;
      }
    }
  };
  child.stdout?.on('data', (c: Buffer) => appendCapped('out', c));
  child.stderr?.on('data', (c: Buffer) => appendCapped('err', c));

  let killedBy: KilledBy | undefined;
  const wallTimer = setTimeout(() => {
    killedBy = 'wallclock';
    // Kill the container OUT-OF-BAND — `docker kill` reaches the daemon even after the
    // `docker run` client is stuck. SIGKILL on the client itself is a fallback.
    spawnSync('docker', ['kill', containerName], { stdio: 'ignore', timeout: 5_000 });
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }, timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(null));
  });
  clearTimeout(wallTimer);

  const wallTimeMs = now() - startedAt;

  let status: SandboxStatus;
  if (killedBy === 'wallclock') {
    status = 'timeout';
  } else if (exitCode === 137) {
    // 137 = 128 + 9 (SIGKILL). Under our memory cap that's the OOM killer.
    status = 'oom';
    killedBy = 'oom';
  } else if (exitCode === 0) {
    status = 'ok';
  } else {
    status = 'crash';
  }

  if (stdoutTruncated) stdout += '\n[truncated]';
  if (stderrTruncated) stderr += '\n[truncated]';

  const result: SandboxResult = {
    status,
    stdout,
    stderr,
    exitCode,
    wallTimeMs,
    containerId: containerName,
  };
  if (killedBy) result.killedBy = killedBy;
  return result;
}
