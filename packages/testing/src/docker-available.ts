// ponytail: mirror of packages/sandbox/src/docker.ts isDockerAvailable().
// Duplicated so @careeros/testing does not take a dep on @careeros/sandbox
// just for one 6-line probe; if a third caller ever needs it, promote to
// @careeros/shared and delete both copies.
import { spawnSync } from 'node:child_process';

/**
 * Returns true when `docker info` succeeds within 5s. Integration tests use
 * this to skip cleanly on machines / CI runners without a daemon.
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
