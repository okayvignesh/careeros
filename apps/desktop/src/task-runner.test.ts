/**
 * J1 task-runner tests. Covers:
 *   - unknown task kind -> failed/unknown-task-kind
 *   - non-allowlisted domain -> failed/domain-not-allowlisted
 *   - happy path dispatches to the matched script with the right mode + entry
 *   - killMidTask() -> 'killed' status before the script runs
 *   - result shape (TaskResult fields present) for each path
 *
 * Playwright is injected via opts.launcher; wss-client / postResult is
 * injected as `postResult`. The test file NEVER spawns a real browser.
 */

import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AllowlistEntry, FormFillPayload, FormFillResult } from '@careeros/browser-agent';
import { TaskRunner, matchAllowlist, type TaskResult } from './task-runner';
import type { LaunchedContext, PlaywrightPage } from './playwright-launcher';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW_ISO = '2026-10-02T12:00:00.000Z';
const EXPIRES_ISO = '2026-10-02T13:00:00.000Z';

const payload: FormFillPayload = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+15551234567',
  resumePath: '/tmp/resume.pdf',
};

function ashbyEntry(): AllowlistEntry {
  return {
    domain: 'ashbyhq.com',
    allowed_paths: ['/'],
    forbidden_selectors: [],
    required_headers: [],
    field_selectors: {
      name: 'input[name=name]',
      email: 'input[name=email]',
    },
    submit_selector: 'button[type=submit]',
    success_signal: 'h1.success',
  };
}

function makeAllowlist(): Map<string, AllowlistEntry> {
  return new Map([['ashbyhq.com', ashbyEntry()]]);
}

function fakePage(): PlaywrightPage {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeLauncher(page: PlaywrightPage): {
  launcher: { chromium: { launchPersistentContext: ReturnType<typeof vi.fn> } };
  context: LaunchedContext;
} {
  const context: LaunchedContext = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    launcher: {
      chromium: {
        launchPersistentContext: vi.fn().mockResolvedValue(context),
      },
    },
    context,
  };
}

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makeTmpUserData(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'task-runner-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('TaskRunner', () => {
  it('rejects an unknown task kind with failureReason=unknown-task-kind', async () => {
    const posted: TaskResult[] = [];
    const { dir, cleanup } = makeTmpUserData();
    try {
      const runner = new TaskRunner({
        isPaused: () => false,
        postResult: async (r) => void posted.push(r),
        userDataDir: dir,
        allowlist: makeAllowlist(),
        payload,
        // Script picker returns undefined to simulate an unmapped kind.
        pickScript: () => undefined,
        logger: silentLogger(),
      });

      await runner.handle({
        id: VALID_UUID,
        kind: 'ashby-apply',
        params: { url: 'https://jobs.ashbyhq.com/acme/apply' },
        createdAt: NOW_ISO,
        expiresAt: EXPIRES_ISO,
      });

      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({
        taskId: VALID_UUID,
        status: 'failed',
        failureReason: 'unknown-task-kind',
      });
      expect(typeof posted[0].durationMs).toBe('number');
    } finally {
      cleanup();
    }
  });

  it('rejects a domain not in the allowlist', async () => {
    const posted: TaskResult[] = [];
    const { dir, cleanup } = makeTmpUserData();
    try {
      const runner = new TaskRunner({
        isPaused: () => false,
        postResult: async (r) => void posted.push(r),
        userDataDir: dir,
        allowlist: makeAllowlist(), // ashbyhq.com only, no wildcard
        payload,
        logger: silentLogger(),
      });

      await runner.handle({
        id: VALID_UUID,
        kind: 'generic-apply',
        params: { url: 'https://evil.example.com/apply' },
        createdAt: NOW_ISO,
        expiresAt: EXPIRES_ISO,
      });

      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({
        taskId: VALID_UUID,
        status: 'failed',
        failureReason: 'domain-not-allowlisted',
      });
    } finally {
      cleanup();
    }
  });

  it('dispatches to the right script with the matched allowlist entry + dry-run default', async () => {
    const posted: TaskResult[] = [];
    const page = fakePage();
    const { launcher, context } = fakeLauncher(page);
    const script = vi.fn<
      Parameters<Parameters<typeof TaskRunner.prototype.handle> extends infer _ ? never : never>,
      Promise<FormFillResult>
    >().mockResolvedValue({
      status: 'ok',
      mode: 'dry-run',
      filledFields: ['name', 'email'],
      submitted: false,
    } satisfies FormFillResult) as unknown as (...a: unknown[]) => Promise<FormFillResult>;
    const { dir, cleanup } = makeTmpUserData();

    try {
      const runner = new TaskRunner({
        isPaused: () => false,
        postResult: async (r) => void posted.push(r),
        userDataDir: dir,
        allowlist: makeAllowlist(),
        payload,
        launcher,
        pickScript: () => script as never,
        logger: silentLogger(),
      });

      await runner.handle({
        id: VALID_UUID,
        kind: 'ashby-apply',
        params: { url: 'https://jobs.ashbyhq.com/acme/apply' },
        createdAt: NOW_ISO,
        expiresAt: EXPIRES_ISO,
      });

      expect(launcher.chromium.launchPersistentContext).toHaveBeenCalledOnce();
      expect(context.newPage).toHaveBeenCalledOnce();
      expect(page.goto).toHaveBeenCalledWith(
        'https://jobs.ashbyhq.com/acme/apply',
        expect.objectContaining({ waitUntil: 'domcontentloaded' }),
      );
      expect(script).toHaveBeenCalledOnce();
      const [pageArg, entryArg, payloadArg, modeArg, optsArg] = (
        script as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls[0];
      expect(pageArg).toBe(page);
      expect((entryArg as AllowlistEntry).domain).toBe('ashbyhq.com');
      expect(payloadArg).toBe(payload);
      expect(modeArg).toBe('dry-run');
      expect((optsArg as { screenshotPath: string }).screenshotPath).toMatch(
        /screenshots\/\d{4}-\d{2}\/.+\.png$/,
      );
      expect(context.close).toHaveBeenCalled();
      expect(posted[0]).toMatchObject({ taskId: VALID_UUID, status: 'ok' });
    } finally {
      cleanup();
    }
  });

  it('aborts and posts killed when killMidTask fires before launch returns', async () => {
    const posted: TaskResult[] = [];
    const page = fakePage();
    const { dir, cleanup } = makeTmpUserData();
    const context: LaunchedContext = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };
    // Launcher resolves AFTER killMidTask is called mid-handle. We trigger
    // the kill by using a deferred promise.
    let resolveLaunch: (ctx: LaunchedContext) => void = () => {};
    const launchPromise = new Promise<LaunchedContext>((res) => {
      resolveLaunch = res;
    });
    const launcher = {
      chromium: {
        launchPersistentContext: vi.fn().mockReturnValue(launchPromise),
      },
    };

    try {
      const runner = new TaskRunner({
        isPaused: () => false,
        postResult: async (r) => void posted.push(r),
        userDataDir: dir,
        allowlist: makeAllowlist(),
        payload,
        launcher,
        pickScript: () => vi.fn().mockResolvedValue({
          status: 'ok',
          mode: 'dry-run',
          filledFields: [],
          submitted: false,
        } satisfies FormFillResult) as never,
        logger: silentLogger(),
      });

      const handlePromise = runner.handle({
        id: VALID_UUID,
        kind: 'ashby-apply',
        params: { url: 'https://jobs.ashbyhq.com/acme/apply' },
        createdAt: NOW_ISO,
        expiresAt: EXPIRES_ISO,
      });

      // Give handle() a tick to await launch, then kill and resolve.
      await new Promise((r) => setImmediate(r));
      runner.killMidTask();
      resolveLaunch(context);
      await handlePromise;

      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ taskId: VALID_UUID, status: 'killed' });
      expect(context.close).toHaveBeenCalled();
      // Script never ran: page.goto was never called.
      expect(page.goto).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('posts killed when the kill-switch sentinel is active at task arrival', async () => {
    const posted: TaskResult[] = [];
    const { dir, cleanup } = makeTmpUserData();
    try {
      const runner = new TaskRunner({
        isPaused: () => true,
        postResult: async (r) => void posted.push(r),
        userDataDir: dir,
        allowlist: makeAllowlist(),
        payload,
        logger: silentLogger(),
      });

      await runner.handle({
        id: VALID_UUID,
        kind: 'ashby-apply',
        params: { url: 'https://jobs.ashbyhq.com/acme/apply' },
        createdAt: NOW_ISO,
        expiresAt: EXPIRES_ISO,
      });

      expect(posted[0]).toMatchObject({
        taskId: VALID_UUID,
        status: 'killed',
        failureReason: 'kill-switch active',
      });
    } finally {
      cleanup();
    }
  });
});

describe('matchAllowlist', () => {
  it('matches exact hostname, suffix, then wildcard, else null', () => {
    const map = new Map<string, AllowlistEntry>([
      ['ashbyhq.com', { ...ashbyEntry(), domain: 'ashbyhq.com' }],
      ['*', { ...ashbyEntry(), domain: '*' }],
    ]);
    expect(matchAllowlist(map, 'ashbyhq.com')?.domain).toBe('ashbyhq.com');
    expect(matchAllowlist(map, 'jobs.ashbyhq.com')?.domain).toBe('ashbyhq.com');
    expect(matchAllowlist(map, 'anything-else.io')?.domain).toBe('*');

    const noWildcard = new Map<string, AllowlistEntry>([
      ['ashbyhq.com', { ...ashbyEntry(), domain: 'ashbyhq.com' }],
    ]);
    expect(matchAllowlist(noWildcard, 'evil.example.com')).toBeNull();
    // Partial suffix must not spoof: `fakeashbyhq.com` does NOT end in `.ashbyhq.com`.
    expect(matchAllowlist(noWildcard, 'fakeashbyhq.com')).toBeNull();
  });
});
