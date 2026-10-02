/**
 * D.4 scaffold: STUB task runner. Validates the inbound task envelope with the
 * shared Zod schema, logs it, and returns a success result without actually
 * driving Playwright.
 *
 * ponytail: Playwright wiring is deferred to "task-runner integration" (next
 * iteration). Upgrade path:
 *   1. Import `pickFormFillScript` from @careeros/browser-agent to pick a
 *      script by task.kind;
 *   2. Launch `playwright.chromium` with `channel: 'chrome'` + userData dir
 *      so the user's logged-in session is reused;
 *   3. Pipe screenshots to MinIO via POST /agent/tasks/:id/result (large
 *      uploads use HTTPS, not WSS per phase-3.5 "Locked sub-decisions");
 *   4. Honour kill-switch (`isAgentPaused()`) before every task + between
 *      sub-steps so pause takes effect mid-run.
 */

import { AgentTask, type AgentResult } from '@careeros/browser-agent';

export type PostResultFn = (
  taskId: string,
  status: 'completed' | 'failed' | 'timeout',
  resultJson: unknown,
) => Promise<void>;

export interface TaskRunnerOptions {
  isPaused: () => boolean;
  postResult: PostResultFn;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export class TaskRunner {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly opts: TaskRunnerOptions) {
    this.log = opts.logger ?? console;
  }

  /**
   * Receive one task from the WSS gateway. Re-validates the envelope at the
   * trust boundary (server pushes come over the wire), then stubs out the
   * execution and posts a result back.
   */
  async handle(raw: unknown): Promise<AgentResult | null> {
    const parsed = AgentTask.safeParse(raw);
    if (!parsed.success) {
      this.log.warn(`task-runner: rejected task (${parsed.error.message})`);
      return null;
    }
    const task = parsed.data;

    if (this.opts.isPaused()) {
      this.log.info(`task-runner: paused; dropping task ${task.id}`);
      // ponytail: paused tasks are dropped without ack; server marks them
      // held on next WSS reconnect per phase-3.5 kill-switch spec. Upgrade
      // path when the dispatcher wants explicit per-task "held" state: POST
      // /agent/tasks/:id/result with a new status 'held' and widen
      // AgentResultStatus enum in @careeros/browser-agent (D.1 owns that
      // schema; coordinate before adding).
      return null;
    }

    this.log.info(`task-runner: STUB received ${task.kind} task ${task.id}`);
    const result: AgentResult = {
      taskId: task.id,
      status: 'ok',
      completedAt: new Date().toISOString(),
    };
    try {
      await this.opts.postResult(task.id, 'completed', { stub: true, kind: task.kind });
    } catch (err) {
      this.log.error(`task-runner: postResult failed: ${(err as Error).message}`);
    }
    return result;
  }
}
