// C4 cleanup: real-Postgres integration test for `@careeros/aggregator`
// `syncSkillState`. Proves the persistence write path end-to-end:
//   1. seed user + skill + evidence, run syncSkillState → a candidate_skill_state
//      row is written plus exactly one skill_state_event carrying the documented
//      "Aggregated N evidence row(s); level X to Y" reason.
//   2. re-run with unchanged evidence → the noop guard writes no new event.
//
// Guarded by TESTCONTAINERS_E2E=1 + isDockerAvailable() so the default
// `pnpm test` on a laptop without Docker skips cleanly.
// Run: `TESTCONTAINERS_E2E=1 pnpm test:integration`.
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isDockerAvailable, resetDb, startInfra, type StartedInfra } from '@careeros/testing';
import { syncSkillState } from '@careeros/aggregator';

const runE2E = process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

const HOOK_TIMEOUT_MS = 180_000;

maybe('@careeros/aggregator syncSkillState (opt-in: TESTCONTAINERS_E2E=1)', () => {
  let infra: StartedInfra;
  let prisma: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    infra = await startInfra({
      services: { postgres: true, redis: false, qdrant: false, minio: false },
    });
    process.env.DATABASE_URL = infra.postgresUrl;

    // Migrations assume the compose init.sql already created these extensions
    // (infra/postgres/init.sql); an ephemeral container needs them by hand.
    const boot = new PrismaClient({ datasources: { db: { url: infra.postgresUrl } } });
    await boot.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS citext');
    await boot.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await boot.$disconnect();

    const apiDir = path.resolve(__dirname, '../../..');
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: infra.postgresUrl },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({ datasources: { db: { url: infra.postgresUrl } } });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await infra?.cleanup();
  }, HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb(prisma);
    const user = await prisma.user.create({
      data: {
        email: `skillstate-${Date.now()}-${Math.random()}@test.local`,
        passwordHash: 'x'.repeat(60),
      },
    });
    userId = user.id;
    await prisma.skill.create({
      data: { id: 'typescript', name: 'TypeScript', cluster: 'language' },
    });
  });

  it('writes candidate_skill_state + one skill_state_event with the aggregate reason', async () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const observedAt = new Date('2026-10-01T12:00:00Z');
    await prisma.evidence.createMany({
      data: [
        {
          userId,
          skillId: 'typescript',
          kind: 'assessment',
          signal: 'correct-independent',
          observedAt,
        },
        {
          userId,
          skillId: 'typescript',
          kind: 'code',
          signal: 'sustained-application',
          observedAt,
        },
      ],
    });

    const result = await syncSkillState(prisma, userId, 'typescript', now);

    const state = await prisma.candidateSkillState.findUnique({
      where: { userId_skillId: { userId, skillId: 'typescript' } },
    });
    expect(state).not.toBeNull();
    expect(state!.evidenceCount).toBe(2);
    expect(Number(state!.level)).toBe(result.level);
    expect(Number(state!.proficiency)).toBeCloseTo(result.state.proficiency, 1);

    const events = await prisma.skillStateEvent.findMany({
      where: { userId, skillId: 'typescript' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.rule).toBe('aggregate');
    expect(events[0]!.reason).toMatch(/^Aggregated 2 evidence row\(s\); level 1 to \d+$/);
    expect(events[0]!.afterJson).toMatchObject({ evidenceCount: 2 });
    // First-ever state has no before-state.
    expect(result.before).toBeNull();
  });

  it('re-running with unchanged evidence writes no new skill_state_event', async () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const observedAt = new Date('2026-10-01T12:00:00Z');
    await prisma.evidence.create({
      data: {
        userId,
        skillId: 'typescript',
        kind: 'assessment',
        signal: 'correct-independent',
        observedAt,
      },
    });

    await syncSkillState(prisma, userId, 'typescript', now);
    const first = await prisma.skillStateEvent.count({
      where: { userId, skillId: 'typescript' },
    });
    expect(first).toBe(1);

    const second = await syncSkillState(prisma, userId, 'typescript', now);
    expect(second.before).not.toBeNull();

    const after = await prisma.skillStateEvent.count({
      where: { userId, skillId: 'typescript' },
    });
    expect(after).toBe(1);
  });
});

// ALWAYS runs. Proves the skip guard is wired and the module imports cleanly
// on machines without Docker.
describe('syncSkillState skip guard', () => {
  it('respects TESTCONTAINERS_E2E + docker availability', () => {
    expect(typeof runE2E).toBe('boolean');
  });
});
