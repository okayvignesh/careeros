import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertStrongDatastoreCred, runStartupChecks } from './startup-check';

// Strong fixtures used by the full-grid tests below. Must be >= 24 bytes
// and not in the datastore-cred weak set, and (for ENC_KEY) decode to 32
// bytes under the strict master-key format.
const STRONG_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex
const STRONG_SESSION_SECRET =
  'wErTyUiOpAsDfGhJkLzXcVbNmQ12345678wErTyUiOpAsDfGhJkLz'; // > 32 bytes
const STRONG_DATASTORE_CRED =
  'k8Xw5Yq3P1zR7vB4mA9fN2sJ6cE0uI/=k8Xw5Yq3P1zR7vB4mA9fN2sJ6cE0uI/=';

/** Env values the full-grid tests mutate on. Saved + restored around every case. */
const MUTATED_KEYS = [
  'NODE_ENV',
  'ENCRYPTION_KEY',
  'SESSION_SECRET',
  'POSTGRES_PASSWORD',
  'MINIO_ROOT_PASSWORD',
  'REDIS_PASSWORD',
  'DATABASE_URL',
  'REDIS_URL',
  'TRUSTED_ORIGINS',
  'USAGE_STATS',
] as const;

// A-H9: exercised via the exported helper so we don't have to mutate
// process.env across the shared vitest worker (the setup file seeds strong
// values so other tests can construct services). Every assertion here would
// pass if the guard is removed, so mutation-smoke reduces to running the
// suite after commenting out the throw — any of these fails immediately.

describe('A-H9 datastore-cred weak-value refusal', () => {
  it('refuses undefined POSTGRES_PASSWORD', () => {
    expect(() => assertStrongDatastoreCred('POSTGRES_PASSWORD', undefined)).toThrow(
      /POSTGRES_PASSWORD is required/,
    );
  });

  it('refuses empty POSTGRES_PASSWORD', () => {
    expect(() => assertStrongDatastoreCred('POSTGRES_PASSWORD', '')).toThrow(
      /POSTGRES_PASSWORD is required/,
    );
  });

  it('refuses POSTGRES_PASSWORD=careeros (the removed compose default)', () => {
    expect(() => assertStrongDatastoreCred('POSTGRES_PASSWORD', 'careeros')).toThrow(
      /known-weak default/,
    );
  });

  it('refuses MINIO_ROOT_PASSWORD=careerosminio (the removed compose default)', () => {
    expect(() => assertStrongDatastoreCred('MINIO_ROOT_PASSWORD', 'careerosminio')).toThrow(
      /known-weak default/,
    );
  });

  it('refuses common weak defaults case-insensitively', () => {
    for (const weak of ['CHANGEME', 'Password', 'admin', 'MinioAdmin', 'root']) {
      expect(() => assertStrongDatastoreCred('POSTGRES_PASSWORD', weak)).toThrow(
        /known-weak default/,
      );
    }
  });

  it('refuses a strong-looking but too-short (8 char) value', () => {
    expect(() => assertStrongDatastoreCred('POSTGRES_PASSWORD', 'aB3!kL9m')).toThrow(
      /too short/,
    );
  });

  it('accepts a 24+ byte non-weak value (openssl rand -base64 32 style)', () => {
    const strong = 'k8Xw5Yq3P1zR7vB4mA9fN2sJ6cE0uI/=';
    expect(() => assertStrongDatastoreCred('POSTGRES_PASSWORD', strong)).not.toThrow();
  });

  it('accepts REDIS_PASSWORD when set to a strong value (optional var path)', () => {
    const strong = 'wErTyUiOpAsDfGhJkLzXcVbNmQ12345678';
    expect(() => assertStrongDatastoreCred('REDIS_PASSWORD', strong)).not.toThrow();
  });
});

// security.md item 1: full negative-case grid against runStartupChecks().
// For every assertion in the function, ONE test proves boot refuses when
// that env is missing or malformed. Saves + restores process.env around
// each case so no cross-test leakage into other suites.
describe('runStartupChecks full negative-case grid (security.md item 1)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of MUTATED_KEYS) saved[k] = process.env[k];
    // Seed a known-good baseline so each test only toggles one axis.
    process.env.NODE_ENV = 'test';
    process.env.ENCRYPTION_KEY = STRONG_ENCRYPTION_KEY;
    process.env.SESSION_SECRET = STRONG_SESSION_SECRET;
    process.env.POSTGRES_PASSWORD = STRONG_DATASTORE_CRED;
    process.env.MINIO_ROOT_PASSWORD = STRONG_DATASTORE_CRED;
    delete process.env.REDIS_PASSWORD; // optional
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/d';
    process.env.REDIS_URL = 'redis://h:6379';
    delete process.env.TRUSTED_ORIGINS;
    delete process.env.USAGE_STATS;
  });

  afterEach(() => {
    for (const k of MUTATED_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('baseline (all strong) passes', () => {
    expect(() => runStartupChecks()).not.toThrow();
  });

  // ─── Secret keys ─────────────────────────────────────────────────────
  it('refuses boot when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => runStartupChecks()).toThrow(/ENCRYPTION_KEY/);
  });

  it('refuses boot when ENCRYPTION_KEY is a known-weak value', () => {
    process.env.ENCRYPTION_KEY = 'changeme';
    expect(() => runStartupChecks()).toThrow(/ENCRYPTION_KEY/);
  });

  it('refuses boot when ENCRYPTION_KEY is too short (< 32 bytes)', () => {
    process.env.ENCRYPTION_KEY = 'short-but-not-in-weak-set';
    expect(() => runStartupChecks()).toThrow(/ENCRYPTION_KEY/);
  });

  it('refuses boot when SESSION_SECRET is missing', () => {
    delete process.env.SESSION_SECRET;
    expect(() => runStartupChecks()).toThrow(/SESSION_SECRET/);
  });

  it('refuses boot when SESSION_SECRET is a known-weak value', () => {
    process.env.SESSION_SECRET = 'changeme';
    expect(() => runStartupChecks()).toThrow(/SESSION_SECRET/);
  });

  it('refuses boot when SESSION_SECRET is too short (< 32 bytes)', () => {
    process.env.SESSION_SECRET = 'tooShort';
    expect(() => runStartupChecks()).toThrow(/SESSION_SECRET/);
  });

  // ─── Datastore creds (A-H9 — the exported-helper tests above cover the
  // weak-value + length branches; these two prove the branches actually fire
  // from inside runStartupChecks) ──────────────────────────────────────
  it('refuses boot when POSTGRES_PASSWORD is missing', () => {
    delete process.env.POSTGRES_PASSWORD;
    expect(() => runStartupChecks()).toThrow(/POSTGRES_PASSWORD/);
  });

  it('refuses boot when MINIO_ROOT_PASSWORD is a known-weak default', () => {
    process.env.MINIO_ROOT_PASSWORD = 'careerosminio';
    expect(() => runStartupChecks()).toThrow(/MINIO_ROOT_PASSWORD/);
  });

  it('refuses boot when MINIO_ROOT_PASSWORD is missing', () => {
    delete process.env.MINIO_ROOT_PASSWORD;
    expect(() => runStartupChecks()).toThrow(/MINIO_ROOT_PASSWORD/);
  });

  it('leaves REDIS_PASSWORD alone when unset (optional var)', () => {
    delete process.env.REDIS_PASSWORD;
    expect(() => runStartupChecks()).not.toThrow();
  });

  it('refuses boot when REDIS_PASSWORD is set but weak (optional var path)', () => {
    process.env.REDIS_PASSWORD = 'changeme';
    expect(() => runStartupChecks()).toThrow(/REDIS_PASSWORD/);
  });

  // ─── Required URLs ───────────────────────────────────────────────────
  it('refuses boot when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => runStartupChecks()).toThrow(/DATABASE_URL/);
  });

  it('refuses boot when REDIS_URL is missing', () => {
    delete process.env.REDIS_URL;
    expect(() => runStartupChecks()).toThrow(/REDIS_URL/);
  });

  // ─── Production-only assertions ──────────────────────────────────────
  it('refuses boot in production when TRUSTED_ORIGINS is missing', () => {
    process.env.NODE_ENV = 'production';
    // DATABASE_URL must still pass the TLS check first, so give it sslmode.
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/d?sslmode=require';
    delete process.env.TRUSTED_ORIGINS;
    expect(() => runStartupChecks()).toThrow(/TRUSTED_ORIGINS/);
  });

  it('refuses boot in production when DATABASE_URL has no sslmode', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_ORIGINS = 'https://app.example';
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/d'; // no sslmode
    expect(() => runStartupChecks()).toThrow(/sslmode/);
  });

  it('refuses boot in production when DATABASE_URL has sslmode=disable', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_ORIGINS = 'https://app.example';
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/d?sslmode=disable';
    expect(() => runStartupChecks()).toThrow(/sslmode/);
  });

  it('production does not bypass secret-strength checks (ENCRYPTION_KEY weak in prod still refuses)', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_ORIGINS = 'https://app.example';
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/d?sslmode=require';
    process.env.ENCRYPTION_KEY = 'password';
    expect(() => runStartupChecks()).toThrow(/ENCRYPTION_KEY/);
  });

  it('accepts production boot when TRUSTED_ORIGINS + sslmode=verify-full set', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_ORIGINS = 'https://app.example';
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/d?sslmode=verify-full';
    expect(() => runStartupChecks()).not.toThrow();
  });

  // ─── USAGE_STATS kill-switch (security.md item 6) ────────────────────
  it('refuses boot when USAGE_STATS is set to an unrecognised value', () => {
    process.env.USAGE_STATS = 'true';
    expect(() => runStartupChecks()).toThrow(/USAGE_STATS/);
  });

  it('accepts USAGE_STATS=on + USAGE_STATS=off + unset', () => {
    process.env.USAGE_STATS = 'on';
    expect(() => runStartupChecks()).not.toThrow();
    process.env.USAGE_STATS = 'off';
    expect(() => runStartupChecks()).not.toThrow();
    delete process.env.USAGE_STATS;
    expect(() => runStartupChecks()).not.toThrow();
  });
});
