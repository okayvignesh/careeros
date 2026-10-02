/**
 * J1 (replaces H2 stub): real Playwright-core task runner.
 *
 * Pipeline per task:
 *   1. Validate envelope with AgentTask Zod schema (trust boundary).
 *   2. Short-circuit if kill-switch is active OR another task is running.
 *   3. Parse `params.url` -> hostname -> allowlist lookup. Reject if the
 *      domain isn't allowlisted (security).
 *   4. Dispatch to the right form-fill script via pickFormFillScript(kind).
 *   5. Launch user's Chrome via launchPersistentChrome (persistent context so
 *      logged-in cookies stick). Navigate to `params.url`.
 *   6. Run the script. On any outcome, close the context.
 *   7. On failure, screenshot to userData/screenshots/YYYY-MM/<task-id>.png
 *      so I1's cleanup pass sweeps it after 30 days.
 *   8. Post result back via the injected postResult fn.
 *
 * Dry-run is the default. Live mode flips on only when `params.mode === 'live'`
 * (server-side gate: F.1 approvals queue sets `params.mode='live'` after an
 * approver signs off on the dry-run diff).
 *
 * ponytail: ONE task at a time. Second arrival while busy -> immediate
 * `failed` with `failureReason: 'busy'`. Upgrade path: swap `busy: boolean`
 * for a FIFO queue + per-task timeout when the user workflow needs multiple
 * concurrent applications (unlikely for a single-user desktop agent).
 *
 * ponytail: retry policy = none. A failed script posts failure and the server
 * decides whether to re-dispatch. Upgrade path: wrap the launch+script call
 * in a 2-attempt retry with 5s backoff if transient Chrome/navigation errors
 * dominate the failure logs.
 *
 * ponytail: linkedin/indeed/naukri scripts are still F.3 stubs; this runner
 * dispatches to them but they'll return `error` until F.3's follow-up ships
 * the real selectors. Nothing to do here.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AgentTask,
  isAgentPaused,
  pickFormFillScript,
  type AllowlistEntry,
  type FormFillMode,
  type FormFillPayload,
  type FormFillResult,
  type FormFillScript,
} from '@careeros/browser-agent';
import {
  defaultUserDataDir,
  launchPersistentChrome,
  type LaunchOptions,
  type LaunchedContext,
  type PlaywrightPage,
} from './playwright-launcher';

export type ResultStatus = 'ok' | 'failed' | 'selector-broken' | 'killed';

export interface TaskResult {
  taskId: string;
  status: ResultStatus;
  screenshot?: string;
  failureReason?: string;
  durationMs: number;
}

export type PostResultFn = (result: TaskResult) => Promise<void>;

export interface TaskRunnerOptions {
  /** Reads the shared kill-switch sentinel (browser-agent/kill-switch). */
  isPaused: () => boolean;
  postResult: PostResultFn;
  /** `app.getPath('userData')` in production; a tmpdir in tests. */
  userDataDir: string;
  /** Allowlist map keyed by domain, loaded once at startup. */
  allowlist: Map<string, AllowlistEntry>;
  /**
   * Default candidate payload (name, email, resumePath, etc.). Overridden
   * per-task if `params.payload` is present on the task envelope so the
   * server can target different applications with different cover letters
   * without the desktop keeping PII pinned in memory.
   */
  payload: FormFillPayload;
  /** Injected for tests. Omit in production (defaults to playwright-core). */
  launcher?: LaunchOptions['launcher'];
  /** Injected for tests. Omit in production (defaults to pickFormFillScript). */
  pickScript?: (kind: AgentTask['kind']) => FormFillScript | undefined;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  /** Injected clock for deterministic durationMs in tests. */
  now?: () => number;
}

export class TaskRunner {
  private busy = false;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly now: () => number;
  /** Set to true by killMidTask() so an in-flight task aborts after its next await. */
  private killRequested = false;
  /** Current context, so an abort can forcibly close the browser. */
  private currentContext: LaunchedContext | null = null;

  constructor(private readonly opts: TaskRunnerOptions) {
    this.log = opts.logger ?? console;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Signal an in-flight task to abort. Called by main.ts when the user hits
   * Pause/Quit in the tray or when the server pushes an abort over WSS.
   */
  killMidTask(): void {
    this.killRequested = true;
    if (this.currentContext) {
      // Fire-and-forget: close() is best-effort during abort.
      void this.currentContext.close().catch(() => {});
    }
  }

  async handle(raw: unknown): Promise<TaskResult | null> {
    const parsed = AgentTask.safeParse(raw);
    if (!parsed.success) {
      this.log.warn(`task-runner: rejected malformed task (${parsed.error.message})`);
      return null;
    }
    const task = parsed.data;
    const started = this.now();

    if (this.opts.isPaused()) {
      this.log.info(`task-runner: paused; dropping task ${task.id}`);
      return this.post({
        taskId: task.id,
        status: 'killed',
        failureReason: 'kill-switch active',
        durationMs: 0,
      });
    }

    if (this.busy) {
      this.log.info(`task-runner: busy; rejecting task ${task.id}`);
      return this.post({
        taskId: task.id,
        status: 'failed',
        failureReason: 'busy',
        durationMs: 0,
      });
    }

    // Pull the url + mode + payload-overrides off `params`. The AgentTask
    // Zod schema only asserts params is a JSON object; per-kind shape is
    // this module's contract with the server-side dispatcher.
    const url = typeof task.params.url === 'string' ? task.params.url : null;
    if (!url) {
      return this.post({
        taskId: task.id,
        status: 'failed',
        failureReason: 'missing-url',
        durationMs: this.now() - started,
      });
    }

    const hostname = safeHostname(url);
    if (!hostname) {
      return this.post({
        taskId: task.id,
        status: 'failed',
        failureReason: 'invalid-url',
        durationMs: this.now() - started,
      });
    }

    const entry = matchAllowlist(this.opts.allowlist, hostname);
    if (!entry) {
      return this.post({
        taskId: task.id,
        status: 'failed',
        failureReason: 'domain-not-allowlisted',
        durationMs: this.now() - started,
      });
    }

    const pickScript = this.opts.pickScript ?? pickFormFillScript;
    const script = pickScript(task.kind);
    if (!script) {
      return this.post({
        taskId: task.id,
        status: 'failed',
        failureReason: 'unknown-task-kind',
        durationMs: this.now() - started,
      });
    }

    // Dry-run default; live mode requires explicit opt-in via params.mode.
    const mode: FormFillMode = task.params.mode === 'live' ? 'live' : 'dry-run';
    const payload = isFormFillPayload(task.params.payload)
      ? { ...this.opts.payload, ...task.params.payload }
      : this.opts.payload;
    const screenshotPath = screenshotPathFor(this.opts.userDataDir, task.id, new Date(this.now()));

    this.busy = true;
    this.killRequested = false;
    try {
      const result = await this.runOne(task.id, url, entry, script, mode, payload, screenshotPath);
      return this.post({ ...result, durationMs: this.now() - started });
    } finally {
      this.busy = false;
      this.killRequested = false;
      this.currentContext = null;
    }
  }

  private async runOne(
    taskId: string,
    url: string,
    entry: AllowlistEntry,
    script: FormFillScript,
    mode: FormFillMode,
    payload: FormFillPayload,
    screenshotPath: string,
  ): Promise<Omit<TaskResult, 'durationMs'>> {
    // ponytail: userDataDir heuristic = single shared "playwright-profile"
    // subdir of Electron's userData. Upgrade when multi-identity matters;
    // see playwright-launcher.ts.
    let context: LaunchedContext;
    try {
      const launchOpts: LaunchOptions = {
        userDataDir: defaultUserDataDir(this.opts.userDataDir),
        headless: false,
      };
      if (this.opts.launcher) launchOpts.launcher = this.opts.launcher;
      context = await launchPersistentChrome(launchOpts);
    } catch (err) {
      return {
        taskId,
        status: 'failed',
        failureReason: `chrome-launch-failed: ${(err as Error).message.slice(0, 200)}`,
      };
    }
    this.currentContext = context;

    if (this.killRequested) {
      await context.close().catch(() => {});
      return { taskId, status: 'killed', failureReason: 'aborted-before-navigate' };
    }

    let page: PlaywrightPage;
    try {
      page = await context.newPage();
      await page.goto(url, { timeout: 30_000, waitUntil: 'domcontentloaded' });
    } catch (err) {
      await context.close().catch(() => {});
      return {
        taskId,
        status: 'failed',
        failureReason: `navigate-failed: ${(err as Error).message.slice(0, 200)}`,
      };
    }

    if (this.killRequested) {
      await context.close().catch(() => {});
      return { taskId, status: 'killed', failureReason: 'aborted-after-navigate' };
    }

    // Ensure the screenshot directory exists before the script writes to it.
    try {
      mkdirSync(dirname(screenshotPath), { recursive: true });
    } catch {
      // non-fatal: screenshot will no-op if the dir isn't writable
    }

    let scriptResult: FormFillResult;
    try {
      scriptResult = await script(page, entry, payload, mode, { screenshotPath });
    } catch (err) {
      await context.close().catch(() => {});
      return {
        taskId,
        status: 'failed',
        failureReason: `script-threw: ${(err as Error).message.slice(0, 200)}`,
        screenshot: screenshotPath,
      };
    }

    await context.close().catch(() => {});

    if (this.killRequested) {
      return { taskId, status: 'killed', failureReason: 'aborted-during-script' };
    }

    return mapScriptResult(taskId, scriptResult, screenshotPath);
  }

  private async post(result: TaskResult): Promise<TaskResult> {
    try {
      await this.opts.postResult(result);
    } catch (err) {
      this.log.error(`task-runner: postResult failed: ${(err as Error).message}`);
    }
    return result;
  }
}

function mapScriptResult(
  taskId: string,
  r: FormFillResult,
  screenshotPath: string,
): Omit<TaskResult, 'durationMs'> {
  if (r.status === 'ok') {
    return { taskId, status: 'ok' };
  }
  if (r.status === 'selector-broken') {
    return {
      taskId,
      status: 'selector-broken',
      failureReason: `missing: ${r.missing.join('; ').slice(0, 500)}`,
      screenshot: r.screenshotPath ?? screenshotPath,
    };
  }
  // r.status === 'error'
  return {
    taskId,
    status: 'failed',
    failureReason: r.error.slice(0, 500),
    screenshot: r.screenshotPath ?? screenshotPath,
  };
}

function isFormFillPayload(v: unknown): v is FormFillPayload {
  // Loose check: an object with string values (or undefined). The script
  // validates per-field so we only need to assert the shape is extensible.
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Match a hostname to an allowlist entry. Exact match wins; otherwise suffix
 * match (hostname ends with `.${domain}`); otherwise the wildcard `*` entry.
 * No wildcard entry present -> null (reject).
 */
export function matchAllowlist(
  allowlist: Map<string, AllowlistEntry>,
  hostname: string,
): AllowlistEntry | null {
  const exact = allowlist.get(hostname);
  if (exact) return exact;
  for (const [domain, entry] of allowlist) {
    if (domain === '*') continue;
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return entry;
  }
  return allowlist.get('*') ?? null;
}

function screenshotPathFor(userDataDir: string, taskId: string, when: Date): string {
  const yyyy = when.getUTCFullYear();
  const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
  // I1's cleanup globs `YYYY-MM/*.png` so match that layout exactly.
  return join(userDataDir, 'screenshots', `${yyyy}-${mm}`, `${taskId}.png`);
}

