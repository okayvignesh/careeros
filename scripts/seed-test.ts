// P0 testing infra: deterministic minimal fixture set for e2e.
//
// Referenced by `plan/testing.md` (§ test-data strategy + §6 e2e rules) and the
// (currently gated) `.github/workflows/restore-test.yml`. Idempotent: every row
// is upserted against a fixed id, so `pnpm seed:test` can run against a
// migrated DB any number of times and always leave the same state.
//
// Run from the repo root: `pnpm seed:test`. Uses the API's generated
// `@prisma/client` and loads `.env` when DATABASE_URL is not already exported.
// ponytail: one file, no CLI framework, no fixture package. Grow a
// `packages/testing` fixture module only when a second seed needs it.

import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SEEDED_AT = new Date('2026-01-01T00:00:00.000Z');

export const TEST_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'test@career-os.local',
  displayName: 'Test User',
  // Login password for e2e: `test-password-12345`. Hash is argon2id with the
  // same options as packages/auth (m=19456, t=2, p=1). Embedded, not recomputed,
  // so the fixture is byte-stable across runs.
  password: 'test-password-12345',
  passwordHash:
    '$argon2id$v=19$m=19456,t=2,p=1$kwyv800exXl3uDUIACN5Sg$Fp3jGJB5enq2Yi35HSKERT+35wbMxGmdV28GN6tL7rA',
} as const;

export const TEST_SKILLS = [
  { id: 'test-skill-typescript', name: 'TypeScript', cluster: 'language', category: 'language' },
  { id: 'test-skill-postgres', name: 'PostgreSQL', cluster: 'tool', category: 'data' },
] as const;

const TEST_EVIDENCE = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    skillId: 'test-skill-typescript',
    kind: 'code',
    signal: 'presence',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    skillId: 'test-skill-postgres',
    kind: 'document',
    signal: 'presence',
  },
] as const;

const TEST_JOB = {
  id: '00000000-0000-4000-8000-000000000201',
  canonicalUrl: 'https://example.test/jobs/test-backend-engineer',
  title: 'Backend Engineer',
  company: 'Test Co',
  location: 'Remote',
  description: 'Deterministic fixture job used by the e2e suite.',
} as const;

const TEST_APPLICATION_ID = '00000000-0000-4000-8000-000000000301';

export interface SeedTestSummary {
  userId: string;
  skills: number;
  evidence: number;
  jobs: number;
}

/** Idempotent. Safe to run repeatedly against a migrated database. */
export async function seedTestFixtures(prisma: PrismaClient): Promise<SeedTestSummary> {
  const userId = TEST_USER.id;

  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email: TEST_USER.email,
      displayName: TEST_USER.displayName,
      passwordHash: TEST_USER.passwordHash,
      createdAt: SEEDED_AT,
    },
    update: {
      email: TEST_USER.email,
      displayName: TEST_USER.displayName,
      passwordHash: TEST_USER.passwordHash,
    },
  });

  await prisma.setupStateRow.upsert({
    where: { userId },
    create: { userId, state: 'complete', completedAt: SEEDED_AT },
    update: { state: 'complete', completedAt: SEEDED_AT },
  });

  await prisma.careerGoal.upsert({
    where: { userId },
    create: {
      userId,
      targetRoles: ['Backend Engineer'],
      locations: ['Remote'],
      remoteOnly: true,
      seniority: ['mid'],
      timezone: 'UTC',
    },
    update: {
      targetRoles: ['Backend Engineer'],
      locations: ['Remote'],
      remoteOnly: true,
      seniority: ['mid'],
      timezone: 'UTC',
    },
  });

  for (const skill of TEST_SKILLS) {
    await prisma.skill.upsert({
      where: { id: skill.id },
      create: skill,
      update: { name: skill.name, cluster: skill.cluster, category: skill.category },
    });

    await prisma.candidateSkillState.upsert({
      where: { userId_skillId: { userId, skillId: skill.id } },
      create: {
        userId,
        skillId: skill.id,
        proficiency: 70,
        confidence: 0.8,
        recencyDays: 0,
        historicalDemonstrated: true,
        evidenceCount: 1,
        level: 4,
      },
      update: {
        proficiency: 70,
        confidence: 0.8,
        recencyDays: 0,
        historicalDemonstrated: true,
        evidenceCount: 1,
        level: 4,
      },
    });
  }

  for (const ev of TEST_EVIDENCE) {
    await prisma.evidence.upsert({
      where: { id: ev.id },
      create: {
        id: ev.id,
        userId,
        skillId: ev.skillId,
        kind: ev.kind,
        signal: ev.signal,
        observedAt: SEEDED_AT,
        detail: { seed: 'seed-test' },
      },
      update: { skillId: ev.skillId, kind: ev.kind, signal: ev.signal, observedAt: SEEDED_AT },
    });
  }

  await prisma.jobRaw.upsert({
    where: { id: TEST_JOB.id },
    create: {
      id: TEST_JOB.id,
      source: 'seed-test',
      sourceId: TEST_JOB.id,
      canonicalUrl: TEST_JOB.canonicalUrl,
      payload: { ...TEST_JOB, seed: 'seed-test' },
      fetchedAt: SEEDED_AT,
    },
    update: {
      canonicalUrl: TEST_JOB.canonicalUrl,
      payload: { ...TEST_JOB, seed: 'seed-test' },
      fetchedAt: SEEDED_AT,
    },
  });

  await prisma.normalizedJob.upsert({
    where: { canonicalUrl: TEST_JOB.canonicalUrl },
    create: {
      id: TEST_JOB.id,
      canonicalUrl: TEST_JOB.canonicalUrl,
      title: TEST_JOB.title,
      company: TEST_JOB.company,
      location: TEST_JOB.location,
      remote: true,
      description: TEST_JOB.description,
      primarySource: 'seed-test',
      state: 'verified',
      skillIds: TEST_SKILLS.map((s) => s.id),
      firstSeenAt: SEEDED_AT,
      lastVerifiedAt: SEEDED_AT,
    },
    update: {
      title: TEST_JOB.title,
      company: TEST_JOB.company,
      location: TEST_JOB.location,
      remote: true,
      description: TEST_JOB.description,
      state: 'verified',
      skillIds: TEST_SKILLS.map((s) => s.id),
    },
  });

  await prisma.application.upsert({
    where: { userId_jobId: { userId, jobId: TEST_JOB.id } },
    create: { id: TEST_APPLICATION_ID, userId, jobId: TEST_JOB.id, state: 'interested' },
    update: { state: 'interested' },
  });

  return {
    userId,
    skills: TEST_SKILLS.length,
    evidence: TEST_EVIDENCE.length,
    jobs: 1,
  };
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    const rootEnv = join(ROOT, '.env');
    if (existsSync(rootEnv)) {
      process.loadEnvFile(rootEnv);
    }
  }
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error(
      '[seed:test] DATABASE_URL is not set. Copy .env.example to .env (or export DATABASE_URL) before seeding.',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  seedTestFixtures(prisma)
    .then(async (summary) => {
      // eslint-disable-next-line no-console
      console.log(
        `[seed:test] ok: user=${summary.userId} skills=${summary.skills} evidence=${summary.evidence} jobs=${summary.jobs}`,
      );
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('[seed:test] failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
