// Post-seed smoke: connect to the API's Postgres, confirm the ESCO seed is
// present at the expected floor + every top-level category is covered.
//
// Run: `pnpm run verify:esco`
//
// Fails loudly (process.exit(1)) if the floor is missed or a category is
// absent. Doesn't mutate anything. Reads `DATABASE_URL` from env (same var
// the API uses). The expected category list is derived from the shipped
// `esco.data.json` so the script and the seed can't drift.
//
// ponytail: no CLI framework. Expected floor + category list are literal
// values asserted below; bump them when the seed grows.

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPECTED_MIN_SKILLS = 188;

interface SeedRow {
  category: string;
}

function loadExpectedCategories(): string[] {
  const path = join(
    __dirname,
    '..',
    'apps',
    'api',
    'src',
    'seed',
    'esco.data.json',
  );
  const rows = JSON.parse(readFileSync(path, 'utf8')) as SeedRow[];
  return Array.from(new Set(rows.map((r) => r.category))).sort();
}

export async function verifyEsco(
  prisma: {
    skill: {
      count: () => Promise<number>;
      findMany: (args: {
        select: { category: true };
        distinct?: ['category'];
      }) => Promise<Array<{ category: string }>>;
    };
  },
  expectedMin: number = EXPECTED_MIN_SKILLS,
  expectedCategories: string[] = loadExpectedCategories(),
): Promise<{ ok: true; total: number; categories: string[] } | never> {
  const total = await prisma.skill.count();
  if (total < expectedMin) {
    throw new Error(
      `[verify:esco] expected >= ${expectedMin} skills, got ${total}. Did the seed run?`,
    );
  }

  const rows = await prisma.skill.findMany({
    select: { category: true },
    distinct: ['category'],
  });
  const seen = new Set(rows.map((r) => r.category));
  const missing = expectedCategories.filter((c) => !seen.has(c));
  if (missing.length > 0) {
    throw new Error(
      `[verify:esco] missing top-level categories: ${missing.join(', ')}. ` +
        `Expected all of: ${expectedCategories.join(', ')}.`,
    );
  }

  return { ok: true, total, categories: Array.from(seen).sort() };
}

// Self-check: scanner + category parse work against a stub prisma. No DB.
// Run via `node --loader ts-node/esm scripts/verify-esco.ts --self-check`
// or just execute and the CLI block below exercises the real DB path.
async function selfCheck(): Promise<void> {
  const cats = ['frontend', 'backend', 'cloud'];
  const fake = {
    skill: {
      count: async () => 200,
      findMany: async () => cats.map((c) => ({ category: c })),
    },
  };
  const res = await verifyEsco(fake, 100, cats);
  if (!res.ok || res.total !== 200) {
    throw new Error('self-check: happy path broken');
  }

  const belowFloor = {
    skill: { ...fake.skill, count: async () => 5 },
  };
  let threw = false;
  try {
    await verifyEsco(belowFloor, 100, cats);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('self-check: floor assertion did not fire');

  const missingCat = {
    skill: { ...fake.skill, findMany: async () => [{ category: 'frontend' }] },
  };
  let threw2 = false;
  try {
    await verifyEsco(missingCat, 100, cats);
  } catch {
    threw2 = true;
  }
  if (!threw2) throw new Error('self-check: missing-category assertion did not fire');

  // eslint-disable-next-line no-console
  console.log('[verify:esco] self-check PASS');
}

if (require.main === module) {
  if (process.argv.includes('--self-check')) {
    selfCheck().catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exit(1);
    });
  } else {
    const prisma = new PrismaClient();
    verifyEsco(prisma)
      .then((res) => {
        // eslint-disable-next-line no-console
        console.log(
          `[verify:esco] OK (${res.total} skills across ${res.categories.length} categories: ${res.categories.join(', ')})`,
        );
        return prisma.$disconnect();
      })
      .catch(async (e) => {
        // eslint-disable-next-line no-console
        console.error(String(e));
        await prisma.$disconnect();
        process.exit(1);
      });
  }
}
