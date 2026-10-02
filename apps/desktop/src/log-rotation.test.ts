import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRotationPass, shouldRotate } from './log-rotation';

/**
 * D.8 rotation tests. Covers the pure predicate + the rename chain under a
 * real tmpdir.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'log-rotation-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOISE_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

describe('shouldRotate', () => {
  const now = 1_700_000_000_000;
  it('no stat (missing file) = no rotation', () => {
    expect(shouldRotate(null, now, 10, 14)).toBeNull();
  });
  it('under size and under age = no rotation', () => {
    expect(shouldRotate({ size: 100, mtimeMs: now - 1_000 }, now, 10_000, 14)).toBeNull();
  });
  it('at or over size = size reason wins', () => {
    expect(shouldRotate({ size: 10_000, mtimeMs: now }, now, 10_000, 14)).toBe('size');
  });
  it('over age threshold = age reason', () => {
    const fifteenDays = 15 * 24 * 60 * 60 * 1000;
    expect(shouldRotate({ size: 10, mtimeMs: now - fifteenDays }, now, 10_000, 14)).toBe('age');
  });
});

describe('runRotationPass', () => {
  it('rotates the chain when the current log exceeds maxBytes', async () => {
    const file = 'agent.log';
    const base = join(dir, file);
    await fs.writeFile(base, 'A'.repeat(2_000));
    await fs.writeFile(`${base}.1`, 'older');

    const result = await runRotationPass({
      dir,
      file,
      maxBytes: 1_000,
      retentionDays: 999, // age not relevant
      keep: 3,
      logger: NOISE_LOGGER,
    });

    expect(result).toMatchObject({ rotated: true, reason: 'size' });
    // chain shifted: new .1 = previous current (2000 bytes); .2 = previous .1
    expect((await fs.stat(`${base}.1`)).size).toBe(2_000);
    expect(await fs.readFile(`${base}.2`, 'utf8')).toBe('older');
    expect(await fs.readFile(base, 'utf8')).toBe('');
  });

  it('drops the oldest when the ring is full', async () => {
    const file = 'agent.log';
    const base = join(dir, file);
    await fs.writeFile(base, 'current-huge-' + 'x'.repeat(10_000));
    await fs.writeFile(`${base}.1`, 'one');
    await fs.writeFile(`${base}.2`, 'two');
    await fs.writeFile(`${base}.3`, 'three-oldest');

    const result = await runRotationPass({
      dir,
      file,
      maxBytes: 1_000,
      retentionDays: 999,
      keep: 3,
      logger: NOISE_LOGGER,
    });

    expect(result).toMatchObject({ rotated: true, droppedOldest: true });
    // .3 is the oldest in a keep=3 ring; it must be gone (unlinked).
    // The chain shifts: previous .1 -> .2, previous .2 -> .3.
    expect(await fs.readFile(`${base}.2`, 'utf8')).toBe('one');
    expect(await fs.readFile(`${base}.3`, 'utf8')).toBe('two');
    // The sentinel "three-oldest" is gone from the ring entirely.
    const contents = await Promise.all(
      ['', '.1', '.2', '.3'].map((suffix) =>
        fs.readFile(`${base}${suffix}`, 'utf8').catch(() => ''),
      ),
    );
    expect(contents.join('|')).not.toContain('three-oldest');
  });

  it('missing current log = no-op (no file to rotate yet)', async () => {
    const result = await runRotationPass({
      dir,
      file: 'nothing-here.log',
      maxBytes: 10,
      logger: NOISE_LOGGER,
    });
    expect(result.rotated).toBe(false);
  });

  it('under both size + age thresholds = no rotation, no chain disturbance', async () => {
    const file = 'agent.log';
    const base = join(dir, file);
    await fs.writeFile(base, 'tiny');
    await fs.writeFile(`${base}.1`, 'untouched');

    const result = await runRotationPass({
      dir,
      file,
      maxBytes: 10_000_000,
      retentionDays: 14,
      logger: NOISE_LOGGER,
    });

    expect(result.rotated).toBe(false);
    expect(await fs.readFile(`${base}.1`, 'utf8')).toBe('untouched');
    expect(await fs.readFile(base, 'utf8')).toBe('tiny');
  });
});
