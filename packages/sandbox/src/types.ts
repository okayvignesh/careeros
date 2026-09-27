export type LanguageId = 'node' | 'python' | 'go' | 'typescript';

export interface LanguageConfig {
  id: LanguageId;
  /** Docker image; pin by digest in prod, human tag here for readability. */
  image: string;
  /** File extension (no dot). */
  extension: string;
  /** File name written into the sandbox tmpfs. */
  entrypoint: string;
  /** Working directory inside the container (also the tmpfs mount target). */
  workdir: string;
  /** Argv passed to `docker run <image> ...`. */
  cmd: string[];
}

export interface RunOptions {
  language: LanguageId;
  code: string;
  stdin?: string;
  /** Wall-clock timeout enforced by the caller (SIGKILL). Default 10s, max 30s. */
  timeoutMs?: number;
  /** Container memory cap. Default 256MB, max 512MB. */
  memoryLimitMb?: number;
}

export type SandboxStatus =
  | 'ok'
  | 'timeout'
  | 'oom'
  | 'crash'
  | 'compile_error'
  | 'paused';

export type KilledBy = 'wallclock' | 'oom' | 'operator';

export interface SandboxResult {
  status: SandboxStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  wallTimeMs: number;
  containerId: string;
  killedBy?: KilledBy;
}

export const MAX_TIMEOUT_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_MEMORY_MB = 512;
export const DEFAULT_MEMORY_MB = 256;
export const MAX_OUTPUT_BYTES = 64 * 1024;
