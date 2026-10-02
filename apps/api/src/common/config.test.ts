import { describe, it, expect } from 'vitest';
import { getUsageStatsConfig } from './config';

// security.md item 6 kill-switch: unset => off (default), `on` opts in,
// any other value throws (fail-loud over silent default so a typo doesn't
// read as the opposite of what the operator meant).

describe('getUsageStatsConfig (USAGE_STATS env stub)', () => {
  it('defaults to off when USAGE_STATS is unset', () => {
    const cfg = getUsageStatsConfig({} as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.rawValue).toBe('off');
  });

  it('defaults to off when USAGE_STATS is empty string', () => {
    const cfg = getUsageStatsConfig({ USAGE_STATS: '' } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.rawValue).toBe('off');
  });

  it('parses USAGE_STATS=on cleanly as opt-in', () => {
    const cfg = getUsageStatsConfig({ USAGE_STATS: 'on' } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(true);
    expect(cfg.rawValue).toBe('on');
  });

  it('parses USAGE_STATS=off cleanly as default', () => {
    const cfg = getUsageStatsConfig({ USAGE_STATS: 'off' } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.rawValue).toBe('off');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(getUsageStatsConfig({ USAGE_STATS: 'ON' } as NodeJS.ProcessEnv).enabled).toBe(true);
    expect(getUsageStatsConfig({ USAGE_STATS: '  on  ' } as NodeJS.ProcessEnv).enabled).toBe(true);
    expect(getUsageStatsConfig({ USAGE_STATS: 'Off' } as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it('throws on any other value (fail loud over silent default)', () => {
    expect(() =>
      getUsageStatsConfig({ USAGE_STATS: 'true' } as NodeJS.ProcessEnv),
    ).toThrow(/USAGE_STATS must be 'on' or 'off'/);
    expect(() =>
      getUsageStatsConfig({ USAGE_STATS: '1' } as NodeJS.ProcessEnv),
    ).toThrow(/USAGE_STATS must be 'on' or 'off'/);
    expect(() =>
      getUsageStatsConfig({ USAGE_STATS: 'yes' } as NodeJS.ProcessEnv),
    ).toThrow(/USAGE_STATS must be 'on' or 'off'/);
  });
});
