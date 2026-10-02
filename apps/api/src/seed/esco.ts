// C-P1.3: ESCO taxonomy seed. Reads `esco.data.json` and idempotently upserts
// every row onto `Skill` keyed by `escoId`. Safe to run against a live db --
// existing rows update in place; missing rows insert. Aliases + category are
// overwritten on each run so the JSON stays the source of truth.
//
// Ponytail: the "taxonomy" is a static JSON. No download, no ontology library,
// no sync worker. Bump the JSON, re-run the script.

import { PrismaClient, type Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EscoSeedRow {
  id: string;
  name: string;
  category: string;
  escoId: string;
  escoUri: string | null;
  aliases: string[];
}

export function loadSeedRows(): EscoSeedRow[] {
  const path = join(__dirname, 'esco.data.json');
  const raw = readFileSync(path, 'utf8');
  const rows = JSON.parse(raw) as EscoSeedRow[];
  validateSeed(rows);
  return rows;
}

/** Throws on the first invariant violation. Called by seed + tests. */
export function validateSeed(rows: EscoSeedRow[]): void {
  const ids = new Set<string>();
  const escoIds = new Set<string>();
  for (const r of rows) {
    if (!r.id || !r.name || !r.category || !r.escoId) {
      throw new Error(`Row missing required field: ${JSON.stringify(r)}`);
    }
    if (ids.has(r.id)) throw new Error(`Duplicate id: ${r.id}`);
    if (escoIds.has(r.escoId)) throw new Error(`Duplicate escoId: ${r.escoId}`);
    ids.add(r.id);
    escoIds.add(r.escoId);
  }
}

export async function seedEsco(prisma: {
  skill: {
    upsert: (args: {
      where: { escoId: string };
      create: Prisma.SkillCreateInput;
      update: Prisma.SkillUpdateInput;
    }) => Promise<unknown>;
  };
}): Promise<{ upserted: number }> {
  const rows = loadSeedRows();
  for (const r of rows) {
    await prisma.skill.upsert({
      where: { escoId: r.escoId },
      create: {
        id: r.id,
        name: r.name,
        category: r.category,
        escoId: r.escoId,
        escoUri: r.escoUri,
        aliases: r.aliases,
      },
      update: {
        name: r.name,
        category: r.category,
        escoUri: r.escoUri,
        aliases: r.aliases,
      },
    });
  }
  return { upserted: rows.length };
}

// ponytail: no yargs, no CLI framework. Run: `pnpm --filter @careeros/api seed:esco`
if (require.main === module) {
  const prisma = new PrismaClient();
  seedEsco(prisma)
    .then(({ upserted }) => {

      console.log(`[esco.seed] upserted ${upserted} skills`);
      return prisma.$disconnect();
    })
    .catch(async (err) => {

      console.error('[esco.seed] failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
