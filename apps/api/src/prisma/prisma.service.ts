import { Inject, Injectable, Optional, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { decryptField, encryptField, isEncryptedField, loadMasterKey } from '@careeros/secrets';
import { MetricsService } from '../common/metrics/metrics.service';

const KEY = loadMasterKey();

/**
 * Field-level encryption spec: table.column → subkey purpose. Any row we read that
 * matches this map has its column decrypted; any row we write has it encrypted.
 * Structured (JSON) columns get JSON-stringified before encrypt / JSON-parsed after
 * decrypt so the api still sees the shape Prisma promises.
 *
 * C-P1.5c: migrated from `$use` middleware (removed in Prisma 6) to
 * `$extends({ query: { $allModels: { $allOperations } } })`. The extension pass
 * DOES run inside `$transaction(async (tx) => ...)` — closing the gap the old
 * middleware left. `resume.service.ts`'s in-transaction manual encrypt is now
 * redundant but harmless (it produces a marker; `encryptRow` no-ops on markers).
 */
const ENCRYPTED_FIELDS: Record<string, { column: string; kind: 'string' | 'json' }> = {
  ResumeFact: { column: 'content', kind: 'json' },
  // A-M4: raw source excerpts logged for eval review. Row still exposes
  // snippetHash + snippetOffset in cleartext for low-privilege lookups.
  LlmHallucinationLog: { column: 'snippet', kind: 'string' },
};

/**
 * Build a `PrismaClient` extended with (1) encryption at write / decryption at
 * read for `ENCRYPTED_FIELDS` and (2) metrics for every query. Factored out so
 * a test can instantiate it directly with a specific `MetricsService` without
 * spinning the whole Nest DI.
 */
export function buildPrismaClient(metrics?: MetricsService) {
  return new PrismaClient().$extends({
    name: 'careeros-encryption-and-metrics',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const spec = ENCRYPTED_FIELDS[model];

          // Write path: encrypt marked columns landing in the request.
          if (spec && isWrite(operation)) {
            const a = args as { data?: unknown } | undefined;
            if (a?.data) {
              if (Array.isArray(a.data)) {
                a.data = a.data.map((row) =>
                  encryptRow(row as Record<string, unknown>, spec),
                );
              } else if (typeof a.data === 'object') {
                a.data = encryptRow(a.data as Record<string, unknown>, spec);
              }
            }
          }

          const start = process.hrtime.bigint();
          let ok = true;
          let result: unknown;
          try {
            result = await query(args);
          } catch (err) {
            ok = false;
            throw err;
          } finally {
            if (metrics) {
              const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
              metrics.prismaQueriesTotal.inc({ model, op: operation, ok: String(ok) });
              metrics.prismaQueryDurationSeconds.observe({ model, op: operation }, durationSec);
            }
          }

          // Read path: decrypt marked columns on the response side.
          if (spec && isRead(operation) && result != null) {
            if (Array.isArray(result)) {
              return result.map((row) => decryptRow(row as Record<string, unknown>, spec));
            }
            if (typeof result === 'object') {
              return decryptRow(result as Record<string, unknown>, spec);
            }
          }
          return result;
        },
      },
      // Raw + client-level operations still deserve latency metrics; the
      // $allModels branch above covers per-model queries but not $queryRaw etc.
      ...(metrics
        ? {
            $allOperations: async ({ operation, args, query }) => {
              const m = metrics;
              const start = process.hrtime.bigint();
              let ok = true;
              try {
                return await query(args);
              } catch (err) {
                ok = false;
                throw err;
              } finally {
                const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
                m.prismaQueriesTotal.inc({ model: 'raw', op: operation, ok: String(ok) });
                m.prismaQueryDurationSeconds.observe({ model: 'raw', op: operation }, durationSec);
              }
            },
          }
        : {}),
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof buildPrismaClient>;

/**
 * Nest DI wrapper. Keeps `PrismaService` as the single injection token every
 * consumer already uses (`private readonly prisma: PrismaService`). Under the
 * hood it constructs the extended client in `onModuleInit` and returns a Proxy
 * from the constructor so property access on `this.prisma.<model>` transparently
 * hits the extended client. Lifecycle hooks stay on the base `PrismaClient` so
 * `$connect` / `$disconnect` continue to work.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private extended: ExtendedPrismaClient | undefined;

  // C-P4.8: metrics service is optional so this class still constructs in
  // tests that don't wire the MetricsModule. In app boot it's always
  // injected because MetricsModule is @Global().
  constructor(@Optional() @Inject(MetricsService) private readonly metrics?: MetricsService) {
    super();

    // Build the extension immediately so consumer access via the Proxy below
    // works even before `onModuleInit` (Nest constructs before init).
    this.extended = buildPrismaClient(this.metrics);

    // Return a Proxy so `this.prisma.<model>.<op>(...)` and `this.prisma.$transaction(...)`
    // route through the extended client (which runs the encryption + metrics extension),
    // while `onModuleInit`/`onModuleDestroy` still hit this base instance.
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        // Nest lifecycle hooks live on `target`; everything else prefers the extended client.
        if (prop === 'onModuleInit' || prop === 'onModuleDestroy') {
          return Reflect.get(target, prop, receiver);
        }
        const ext = target.extended;
        if (ext && prop in (ext as object)) {
          const v = Reflect.get(ext as object, prop);
          return typeof v === 'function' ? v.bind(ext) : v;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  async onModuleInit(): Promise<void> {
    // Extended client shares the underlying connection pool with this base
    // instance; connecting once is enough.
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

function isWrite(op: string): boolean {
  return (
    op === 'create' ||
    op === 'createMany' ||
    op === 'createManyAndReturn' ||
    op === 'update' ||
    op === 'updateMany' ||
    op === 'updateManyAndReturn' ||
    op === 'upsert'
  );
}

function isRead(op: string): boolean {
  return (
    op === 'findFirst' ||
    op === 'findFirstOrThrow' ||
    op === 'findUnique' ||
    op === 'findUniqueOrThrow' ||
    op === 'findMany'
  );
}

function encryptRow(
  row: Record<string, unknown>,
  spec: { column: string; kind: 'string' | 'json' },
): Record<string, unknown> {
  const raw = row[spec.column];
  if (raw == null) return row;
  const asString = spec.kind === 'json' ? JSON.stringify(raw) : String(raw);
  if (isEncryptedField(asString)) return row; // already marked
  return { ...row, [spec.column]: encryptField(asString, KEY, spec.column) };
}

function decryptRow(
  row: Record<string, unknown>,
  spec: { column: string; kind: 'string' | 'json' },
): Record<string, unknown> {
  const raw = row[spec.column];
  if (raw == null) return row;
  if (typeof raw !== 'string') return row; // JSON column with unencrypted legacy value
  if (!isEncryptedField(raw)) {
    // Pre-encryption legacy row. Return as-is; Prisma already parsed JSON columns.
    return row;
  }
  const plain = decryptField(raw, KEY, spec.column);
  const value = spec.kind === 'json' ? JSON.parse(plain) : plain;
  return { ...row, [spec.column]: value };
}
