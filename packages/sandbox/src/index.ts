// C-P2.4: consumed by apps/api/src/modules/assessments/assessments.service.ts
// (gradeBuildAttempt) to run user-submitted build-task code in Docker-per-run.
import { runDockerContainer, isDockerAvailable, buildDockerArgs, generateContainerName } from './docker';
import { withPool } from './pool';
import { isSandboxPaused } from './kill-switch';
import type { RunOptions, SandboxResult } from './types';

/**
 * Public entry point. Applies the kill-switch first (short-circuits without touching
 * docker), then queues via the N=2 pool, then runs one container end-to-end.
 *
 * Never throws: docker/spawn failures come back as `status: 'crash'` with the error
 * on stderr. The API caller must treat a rejected promise as a bug in the sandbox
 * layer, not user code.
 */
export async function runSandboxed(opts: RunOptions): Promise<SandboxResult> {
  if (isSandboxPaused()) {
    return {
      status: 'paused',
      stdout: '',
      stderr: 'sandbox is paused by operator',
      exitCode: null,
      wallTimeMs: 0,
      containerId: '',
      killedBy: 'operator',
    };
  }
  return withPool(() => runDockerContainer(opts));
}

export {
  pauseSandbox,
  resumeSandbox,
  isSandboxPaused,
  getPausedFilePath,
} from './kill-switch';
export { getPoolConcurrency, setPoolConcurrency, DEFAULT_CONCURRENCY } from './pool';
export { isDockerAvailable, buildDockerArgs, generateContainerName } from './docker';
export { LANGUAGES, getLanguageConfig } from './languages';
export type {
  RunOptions,
  SandboxResult,
  SandboxStatus,
  KilledBy,
  LanguageId,
  LanguageConfig,
} from './types';
