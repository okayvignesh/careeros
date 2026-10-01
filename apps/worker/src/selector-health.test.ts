import { describe, expect, it, vi } from 'vitest';
import type { AllowlistEntry } from '@careeros/browser-agent';
import {
  handleSelectorHealth,
  markSelectorStale,
  runSelectorHealth,
  type ProbeOutcome,
  type SelectorHealthRepo,
} from './selector-health.worker';

function makeRepo(): { repo: SelectorHealthRepo; audits: unknown[]; appUpdates: unknown[] } {
  const audits: unknown[] = [];
  const appUpdates: unknown[] = [];
  const repo: SelectorHealthRepo = {
    auditEvent: {
      async create(args) {
        audits.push(args.data);
        return args.data;
      },
    },
    application: {
      async updateMany(args) {
        appUpdates.push(args);
        return { count: 1 };
      },
    },
  };
  return { repo, audits, appUpdates };
}

const entry = (domain: string): AllowlistEntry => ({
  domain,
  allowed_paths: ['/'],
  forbidden_selectors: [],
  required_headers: [],
  field_selectors: { email: 'input[type=email]' },
  submit_selector: 'button[type=submit]',
});

describe('runSelectorHealth', () => {
  it('skips healthy entries, audits stale ones', async () => {
    const probe = async (e: AllowlistEntry): Promise<ProbeOutcome> =>
      e.domain === 'ashbyhq.com'
        ? { domain: e.domain, healthy: true, missing: [], drifted: [] }
        : { domain: e.domain, healthy: false, missing: ['input[type=email]'], drifted: [] };
    const { repo, audits } = makeRepo();
    const result = await runSelectorHealth(
      [entry('ashbyhq.com'), entry('greenhouse.io')],
      probe,
      repo,
    );
    expect(result.totalProbed).toBe(2);
    expect(result.staleDomains).toEqual(['greenhouse.io']);
    expect(audits).toHaveLength(1);
    expect((audits[0] as { action: string }).action).toBe('form_fill.selector_stale');
    expect((audits[0] as { resourceId: string }).resourceId).toBe('greenhouse.io');
  });

  it('emits payload with missing + drifted selectors', async () => {
    const probe = async (e: AllowlistEntry): Promise<ProbeOutcome> => ({
      domain: e.domain,
      healthy: false,
      missing: ['input[type=email]'],
      drifted: ['button[type=submit]'],
    });
    const { repo, audits } = makeRepo();
    await runSelectorHealth([entry('x.com')], probe, repo);
    const payload = (audits[0] as { payload: { missing: string[]; drifted: string[] } }).payload;
    expect(payload.missing).toEqual(['input[type=email]']);
    expect(payload.drifted).toEqual(['button[type=submit]']);
  });
});

describe('markSelectorStale (live-path hook)', () => {
  it('writes audit row and tags the application', async () => {
    const { repo, audits, appUpdates } = makeRepo();
    await markSelectorStale(
      repo,
      { domain: 'ashbyhq.com', healthy: false, missing: ['x'], drifted: [] },
      'agent',
      { applicationId: 'app-123', userId: 'user-7' },
    );
    expect(audits).toHaveLength(1);
    expect((audits[0] as { actor: string }).actor).toBe('agent');
    expect((audits[0] as { userId: string }).userId).toBe('user-7');
    expect(appUpdates).toHaveLength(1);
    const upd = appUpdates[0] as { where: { id: string }; data: { notes: unknown } };
    expect(upd.where.id).toBe('app-123');
    expect(upd.data.notes).toEqual({ set: '[selector-stale:ashbyhq.com]' });
  });

  it('skips the application update when no applicationId supplied (cron path)', async () => {
    const { repo, audits, appUpdates } = makeRepo();
    await markSelectorStale(
      repo,
      { domain: 'ashbyhq.com', healthy: false, missing: ['x'], drifted: [] },
      'system',
    );
    expect(audits).toHaveLength(1);
    expect(appUpdates).toHaveLength(0);
  });
});

describe('handleSelectorHealth', () => {
  it('logs structured summary on success', async () => {
    const probe = async (e: AllowlistEntry): Promise<ProbeOutcome> => ({
      domain: e.domain,
      healthy: true,
      missing: [],
      drifted: [],
    });
    const { repo } = makeRepo();
    const info = vi.fn();
    const error = vi.fn();
    const result = await handleSelectorHealth([entry('a.com')], probe, repo, { info, error });
    expect(result.totalProbed).toBe(1);
    expect(info).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('logs error and rethrows on probe failure', async () => {
    const probe = async (): Promise<ProbeOutcome> => {
      throw new Error('probe exploded');
    };
    const { repo } = makeRepo();
    const info = vi.fn();
    const error = vi.fn();
    await expect(
      handleSelectorHealth([entry('a.com')], probe, repo, { info, error }),
    ).rejects.toThrow('probe exploded');
    expect(error).toHaveBeenCalledOnce();
  });
});
