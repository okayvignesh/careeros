import { describe, expect, it } from 'vitest';
import { EMAIL_CLASSES, type EmailClass } from '@careeros/shared';
import { runEmailClassifierEvals } from './index';

/**
 * E.5 heuristic-only eval, run in CI. LLM live mode is opt-in and lives
 * in a follow-up slice (needs a real provider config).
 *
 * We assert:
 *   1. every class has at least the target scaffold count of fixtures
 *   2. the heuristic-only pass rate per class hits the plan bar (100%
 *      for the sender-driven job_alert_* classes; >= 90% for the subject-
 *      driven classes; `other` fixtures always pass because they are
 *      the fallback contract)
 */

describe('email-classifier heuristic eval', () => {
  it('runs the suite and reports per-class results', async () => {
    const result = await runEmailClassifierEvals();
    expect(result.overall.total).toBeGreaterThan(0);
    for (const cls of EMAIL_CLASSES) {
      expect(result.perClass[cls as EmailClass]).toBeDefined();
      expect(result.perClass[cls as EmailClass].total).toBeGreaterThanOrEqual(3);
    }
    // MUTATION-SMOKE: drop a fixture class and this fails.
  });

  it('hits 100% on sender-driven classes (job_alert_*)', async () => {
    const result = await runEmailClassifierEvals();
    const senderDriven: EmailClass[] = [
      'job_alert_linkedin',
      'job_alert_indeed',
      'job_alert_naukri',
    ];
    for (const cls of senderDriven) {
      const stats = result.perClass[cls];
      expect(stats.passed).toBe(stats.total);
    }
  });

  it('hits >= 90% on subject-driven classes (rejection, offer, interview_invite, assessment, recruiter)', async () => {
    const result = await runEmailClassifierEvals();
    const subjectDriven: EmailClass[] = [
      'rejection',
      'offer',
      'interview_invite',
      'assessment',
      'recruiter',
    ];
    for (const cls of subjectDriven) {
      const stats = result.perClass[cls];
      const rate = stats.passed / stats.total;
      expect(rate).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('other class always resolves to other (fallback contract)', async () => {
    const result = await runEmailClassifierEvals();
    const others = result.results.filter((r) => r.fixture.expectedClass === 'other');
    for (const r of others) {
      expect(r.output.class).toBe('other');
      expect(r.passed).toBe(true);
    }
  });
});
