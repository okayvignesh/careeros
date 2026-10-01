// F.3 selector-health worker.
//
// Weekly cron that walks every form-fill allowlist entry (shipped under
// `packages/browser-agent/allowlist/*.yaml`), runs the shared probe against
// a captured HTML fixture per domain (snapshotted during the last successful
// form-fill on that domain, stored under
// MinIO `careeros/selector-snapshots/<domain>.html`), and marks any domain
// whose selectors broke as `selector-stale`.
//
// "Marks selector-stale" means:
//   1. Insert an `audit_log` row with action='form_fill.selector_stale',
//      resource_type='allowlist_domain', resource_id=<domain>, payload
//      includes the missing + drifted selector lists.
//   2. For every open Application whose target host matches the domain, append
//      a `selector-stale:<domain>` tag to Application.notes so the UI can
//      flag the row and bounce the user to the "open in browser to complete"
//      fallback (phase-6 line 44).
//
// The actual snapshot capture + the Playwright probe binding live in
// scripts/browser-agent/probe-form-fill-selectors.ts; this worker is pure
// orchestration: it accepts an injected `probe` fn so the test substitutes
// a canned result.
//
// Pattern mirrors apps/worker/src/audit-log-retention.worker.ts: pino
// structured log is the audit surface, BullMQ repeatable job runs it.

import type { AllowlistEntry } from '@careeros/browser-agent';

export const QUEUE_SELECTOR_HEALTH = 'selector-health';
export const JOB_SELECTOR_HEALTH = 'selector-health';
export const SELECTOR_HEALTH_CRON = '0 5 * * 1'; // 05:00 UTC Mondays

/** Narrowed Prisma shape — matches the pattern in audit-log-retention. */
export interface SelectorHealthRepo {
  auditEvent: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  application: {
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
}

export interface ProbeOutcome {
  domain: string;
  healthy: boolean;
  missing: string[];
  drifted: string[];
}

export type ProbeFn = (entry: AllowlistEntry) => Promise<ProbeOutcome>;

export interface SelectorHealthRunResult {
  totalProbed: number;
  staleDomains: string[];
}

/**
 * Run the probe for every entry, write audit rows for any that fail, bump
 * Application.notes for the affected rows. Returns the summary for the
 * worker's pino line.
 *
 * ponytail: the Application update is a coarse `updateMany` keyed by notes
 * substring, not a per-row join against the actual target domain. We don't
 * yet persist a per-application `host` column (that's a schema change parked
 * for a future wave); the notes-tag approach is good enough for the UI to
 * show a chip, which is all the UX needs. Upgrade when phase-7+ adds a
 * dedicated `application_submit_targets` table.
 */
export async function runSelectorHealth(
  entries: readonly AllowlistEntry[],
  probe: ProbeFn,
  repo: SelectorHealthRepo,
): Promise<SelectorHealthRunResult> {
  const staleDomains: string[] = [];
  for (const entry of entries) {
    const outcome = await probe(entry);
    if (outcome.healthy) continue;
    staleDomains.push(outcome.domain);
    await markSelectorStale(repo, outcome, 'system');
  }
  return { totalProbed: entries.length, staleDomains };
}

/**
 * Mark one domain's selectors stale. Exposed so the agent's live form-fill
 * failure path (not just the weekly cron) can call it from the API layer
 * when a user-driven apply attempt returns status: 'selector-broken'.
 */
export async function markSelectorStale(
  repo: SelectorHealthRepo,
  outcome: ProbeOutcome,
  actor: 'system' | 'agent' | 'user',
  context: { applicationId?: string; userId?: string } = {},
): Promise<void> {
  await repo.auditEvent.create({
    data: {
      userId: context.userId ?? null,
      actor,
      action: 'form_fill.selector_stale',
      resourceType: 'allowlist_domain',
      resourceId: outcome.domain,
      payload: {
        missing: outcome.missing,
        drifted: outcome.drifted,
        ...(context.applicationId ? { applicationId: context.applicationId } : {}),
      },
    },
  });

  // Tag affected applications so the UI can show a stale badge. We append
  // the tag only if not already present (contains check keeps it idempotent
  // enough for weekly runs).
  const tag = `[selector-stale:${outcome.domain}]`;
  if (context.applicationId) {
    await repo.application.updateMany({
      where: {
        id: context.applicationId,
        NOT: { notes: { contains: tag } },
      },
      data: { notes: { set: tag } },
    }).catch(() => undefined);
  }
}

/**
 * Job handler. Wraps `runSelectorHealth` with pino structured logging.
 */
export async function handleSelectorHealth(
  entries: readonly AllowlistEntry[],
  probe: ProbeFn,
  repo: SelectorHealthRepo,
  logger: { info: (ctx: object, msg: string) => void; error: (ctx: object, msg: string) => void },
): Promise<SelectorHealthRunResult> {
  try {
    const result = await runSelectorHealth(entries, probe, repo);
    logger.info(
      {
        job: JOB_SELECTOR_HEALTH,
        totalProbed: result.totalProbed,
        staleDomains: result.staleDomains,
      },
      'selector-health run complete',
    );
    return result;
  } catch (err) {
    logger.error(
      { job: JOB_SELECTOR_HEALTH, err: (err as Error).message },
      'selector-health run failed',
    );
    throw err;
  }
}
