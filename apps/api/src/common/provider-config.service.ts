import { BadRequestException, Injectable } from '@nestjs/common';
import {
  providerFields,
  isKnownProvider,
  resolveProviderConfig,
  type ProviderConfigShape,
  type ProviderConfigView,
} from '@careeros/shared';
import { decryptField, encryptField, isEncryptedField, loadMasterKey } from '@careeros/secrets';
import type { ProviderFieldsInput } from '@careeros/shared';
import { PrismaService } from '../prisma/prisma.service';

export const PROVIDER_CONFIG_KEY_PREFIX = 'provider_config:';

/** Field-level encryption purpose. Colon-free: `encryptField`'s marker parser reserves ':'. */
function purpose(id: string, field: string): string {
  return `provider.${id}.${field}`;
}

function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw;
  }
  return out;
}

function parseShape(value: unknown): ProviderConfigShape | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return { values: asStringMap(record.values), secrets: asStringMap(record.secrets) };
}

/**
 * DB-backed provider config on the existing `app_config` table (no migration).
 * One row per provider at `provider_config:<id>` shaped
 * `{ values: Record<string,string>, secrets: Record<string,string> }`.
 *
 * Secret fields are sealed with `encryptField` before they touch the DB and are
 * never returned by the API — `view()` exposes only `has` booleans. `resolve()`
 * is the internal, decrypted view used to construct adapters.
 */
@Injectable()
export class ProviderConfigService {
  constructor(private readonly prisma: PrismaService) {}

  private key(id: string): string {
    return `${PROVIDER_CONFIG_KEY_PREFIX}${id}`;
  }

  private async readShape(id: string): Promise<ProviderConfigShape | null> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: this.key(id) } });
    return parseShape(row?.value);
  }

  /** Client-safe effective view for one provider (DB first, env fallback). */
  async view(id: string, env: Readonly<Record<string, string | undefined>> = process.env): Promise<ProviderConfigView> {
    return resolveProviderConfig(id, await this.readShape(id), env);
  }

  /** Batch variant for a provider list; one query regardless of count. */
  async views(
    ids: readonly string[],
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): Promise<Map<string, ProviderConfigView>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.appConfig.findMany({
      where: { key: { in: ids.map((id) => this.key(id)) } },
    });
    const valueByKey = new Map(rows.map((row) => [row.key, row.value]));
    const out = new Map<string, ProviderConfigView>();
    for (const id of ids) {
      out.set(id, resolveProviderConfig(id, parseShape(valueByKey.get(this.key(id))), env));
    }
    return out;
  }

  /**
   * Internal decrypted config for adapter construction. Never returned by the
   * API. Public values are DB-first with env fallback; secrets are unsealed
   * from the DB or taken from env when nothing is stored.
   */
  async resolve(
    id: string,
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): Promise<{ values: Record<string, string>; secrets: Record<string, string> }> {
    const shape = await this.readShape(id);
    const view = resolveProviderConfig(id, shape, env);
    const secrets: Record<string, string> = {};
    const master = loadMasterKey();
    for (const field of providerFields(id)) {
      if (!field.secret) continue;
      const stored = shape?.secrets?.[field.name];
      if (stored && isEncryptedField(stored)) {
        secrets[field.name] = decryptField(stored, master, purpose(id, field.name));
      } else if (stored && stored.trim()) {
        // Legacy/lazy plaintext: pass through, the next save seals it.
        secrets[field.name] = stored;
      } else if (field.envVar && env[field.envVar]?.trim()) {
        secrets[field.name] = env[field.envVar]!.trim();
      }
    }
    return { values: view.values, secrets };
  }

  /**
   * Persist an edit. Public fields are stored verbatim; secret fields are sealed
   * only when a non-empty value is supplied — a blank secret keeps the stored
   * one. Unknown providers/fields are rejected.
   */
  async save(
    id: string,
    input: ProviderFieldsInput,
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): Promise<ProviderConfigView> {
    if (!isKnownProvider(id)) throw new BadRequestException(`Unknown provider: ${id}`);
    const fields = providerFields(id);
    const byName = new Map(fields.map((field) => [field.name, field]));
    for (const name of Object.keys(input.values)) {
      if (!byName.has(name)) {
        throw new BadRequestException(`Unknown field '${name}' for provider '${id}'`);
      }
    }

    const existing = (await this.readShape(id)) ?? { values: {}, secrets: {} };
    const values = { ...existing.values };
    const secrets = { ...existing.secrets };
    const master = loadMasterKey();

    for (const field of fields) {
      const raw = input.values[field.name];
      if (raw === undefined) continue;
      const trimmed = raw.trim();
      if (field.secret) {
        if (trimmed.length > 0) secrets[field.name] = encryptField(trimmed, master, purpose(id, field.name));
        continue;
      }
      if (trimmed.length > 0) values[field.name] = trimmed;
      else delete values[field.name];
    }

    await this.prisma.appConfig.upsert({
      where: { key: this.key(id) },
      create: { key: this.key(id), value: { values, secrets } as object },
      update: { value: { values, secrets } as object },
    });
    return resolveProviderConfig(id, { values, secrets }, env);
  }
}
