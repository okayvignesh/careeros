import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCleanupPass } from './screenshot-cleanup';

/**
 * D.8 cleanup tests. Real filesystem under a tmpdir so mtime semantics
 * match production. Covers: fresh file survives, stale file is unlinked,
 * YYYY-MM subdir recursion works, missing dir is a clean no-op.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'screenshot-cleanup-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function touchFile(path: string, mtimeMs: number): Promise<void> {
  await fs.writeFile(path, 'png-bytes');
  const time = new Date(mtimeMs);
  await fs.utimes(path, time, time);
}

describe('runCleanupPass', () => {
  it('deletes files older than retention + keeps fresh files', async () => {
    const now = Date.now();
    const stale = join(dir, 'stale.png');
    const fresh = join(dir, 'fresh.png');
    await touchFile(stale, now - 40 * 24 * 60 * 60 * 1000);
    await touchFile(fresh, now - 2 * 24 * 60 * 60 * 1000);

    const result = await runCleanupPass({
      dir,
      retentionDays: 30,
      now: () => now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result).toMatchObject({ scanned: 2, deleted: 1, errors: 0 });
    await expect(fs.access(stale)).rejects.toThrow();
    await expect(fs.access(fresh)).resolves.toBeUndefined();
  });

  it('recurses into YYYY-MM subdirs (phase-3.5 layout)', async () => {
    const now = Date.now();
    const sub = join(dir, '2026-09');
    await fs.mkdir(sub, { recursive: true });
    const staleNested = join(sub, 'shot.png');
    await touchFile(staleNested, now - 60 * 24 * 60 * 60 * 1000);

    const result = await runCleanupPass({
      dir,
      retentionDays: 30,
      now: () => now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.deleted).toBe(1);
    await expect(fs.access(staleNested)).rejects.toThrow();
  });

  it('missing directory is a clean no-op (nothing captured yet)', async () => {
    const result = await runCleanupPass({
      dir: join(dir, 'does-not-exist'),
      retentionDays: 30,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(result).toEqual({ scanned: 0, deleted: 0, errors: 0 });
  });

  it('exactly-at-cutoff files survive (strict less-than)', async () => {
    const now = Date.now();
    const borderline = join(dir, 'borderline.png');
    await touchFile(borderline, now - 30 * 24 * 60 * 60 * 1000);

    const result = await runCleanupPass({
      dir,
      retentionDays: 30,
      now: () => now,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.deleted).toBe(0);
    await expect(fs.access(borderline)).resolves.toBeUndefined();
  });
});
