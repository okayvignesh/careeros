import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { decryptField, encryptField, isEncryptedField, loadMasterKey } from '@careeros/secrets';

const KEY = loadMasterKey();

/**
 * Field-level encryption spec: table.column → subkey purpose. Any row we read that
 * matches this map has its column decrypted; any row we write has it encrypted.
 * Structured (JSON) columns get JSON-stringified before encrypt / JSON-parsed after
 * decrypt so the api still sees the shape Prisma promises.
 *
 * IMPORTANT: Prisma's legacy `$use` middleware does NOT run for calls made through
 * the interactive-transaction client (`await this.prisma.$transaction(async (tx) => ...)`).
 * If you write a marked column inside `tx.<model>.create[Many]|update|upsert`, you MUST
 * call `encryptField(...)` yourself before the write. Read paths outside transactions
 * still get automatic decryption via the middleware below.
 *
 * When we migrate off `$use` (Prisma 6 removes it), switch to `PrismaClient.$extends`
 * with `query: { $allOperations }` — that DOES run inside transactions and closes the
 * gap. Tracked under slice-7 debt.
 */
const ENCRYPTED_FIELDS: Record<string, { column: string; kind: 'string' | 'json' }> = {
  ResumeFact: { column: 'content', kind: 'json' },
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    // Prisma middleware. Wraps every request; encrypts on create/update, decrypts on read.
    // Idempotent: values already carrying our marker are passed through unchanged.
    this.$use(async (params, next) => {
      const spec = params.model ? ENCRYPTED_FIELDS[params.model] : undefined;
      if (!spec) return next(params);

      // Write path: encrypt any marked column landing in the request.
      if (isWrite(params.action)) {
        if (params.args?.data) {
          if (Array.isArray(params.args.data)) {
            params.args.data = params.args.data.map((row: Record<string, unknown>) =>
              encryptRow(row, spec),
            );
          } else if (typeof params.args.data === 'object') {
            params.args.data = encryptRow(params.args.data as Record<string, unknown>, spec);
          }
        }
      }

      const result = await next(params);

      // Read path: decrypt marked columns on the response side.
      if (isRead(params.action) && result != null) {
        if (Array.isArray(result)) {
          return result.map((row) => decryptRow(row as Record<string, unknown>, spec));
        }
        if (typeof result === 'object') {
          return decryptRow(result as Record<string, unknown>, spec);
        }
      }
      return result;
    });

    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

function isWrite(action: string): boolean {
  return (
    action === 'create' ||
    action === 'createMany' ||
    action === 'update' ||
    action === 'updateMany' ||
    action === 'upsert'
  );
}

function isRead(action: string): boolean {
  return (
    action === 'findFirst' ||
    action === 'findFirstOrThrow' ||
    action === 'findUnique' ||
    action === 'findUniqueOrThrow' ||
    action === 'findMany'
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
