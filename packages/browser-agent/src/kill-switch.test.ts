import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetKillSwitchCacheForTests,
  getPausedFilePath,
  isAgentPaused,
  pauseAgent,
  resumeAgent,
} from './kill-switch';

describe('agent kill-switch (file-persisted)', () => {
  let dir: string;
  let flagPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'careeros-agent-ks-'));
    flagPath = join(dir, 'agent.paused');
    prev = process.env.AGENT_PAUSED_FILE;
    process.env.AGENT_PAUSED_FILE = flagPath;
    __resetKillSwitchCacheForTests();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.AGENT_PAUSED_FILE;
    else process.env.AGENT_PAUSED_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
    __resetKillSwitchCacheForTests();
  });

  it('env override drives the file path', () => {
    expect(getPausedFilePath()).toBe(flagPath);
  });

  it('defaults to not paused when the file does not exist', () => {
    expect(isAgentPaused()).toBe(false);
  });

  it('pauseAgent writes the flag and isAgentPaused reports true', () => {
    pauseAgent();
    expect(existsSync(flagPath)).toBe(true);
    expect(isAgentPaused()).toBe(true);
  });

  it('resumeAgent removes the flag', () => {
    pauseAgent();
    resumeAgent();
    expect(existsSync(flagPath)).toBe(false);
    expect(isAgentPaused()).toBe(false);
  });

  it('resumeAgent on a missing file is idempotent', () => {
    expect(() => resumeAgent()).not.toThrow();
    expect(isAgentPaused()).toBe(false);
  });

  it('picks up out-of-band pause after cache reset', () => {
    expect(isAgentPaused()).toBe(false);
    writeFileSync(flagPath, '');
    __resetKillSwitchCacheForTests();
    expect(isAgentPaused()).toBe(true);
  });
});
