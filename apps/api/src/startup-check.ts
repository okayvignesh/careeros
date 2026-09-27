import { assertStrongKey } from '@careeros/secrets';

/**
 * Refuses to start if required env is missing or weak.
 * Runs before Nest bootstrap. Any failure → process exit 1 with clear message.
 */
export function runStartupChecks(): void {
  const isProd = process.env.NODE_ENV === 'production';

  assertStrongKey('ENCRYPTION_KEY', process.env.ENCRYPTION_KEY);
  assertStrongKey('SESSION_SECRET', process.env.SESSION_SECRET);

  // === A-auth session-secret assertion ===
  // SessionService reads process.env.SESSION_SECRET lazily inside its
  // constructor (A-H3). Boot must have failed above if the secret was missing
  // or weak; this line is defense in depth against a future refactor that
  // drops assertStrongKey but leaves the SessionService import path alive.
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set before AuthModule loads (A-H3).');
  }
  // === end A-auth ===

  // === A-infra weak-cred assertions ===
  // A-H9: refuse boot if POSTGRES_PASSWORD or MINIO_ROOT_PASSWORD is missing,
  // short, or matches a known weak default. Docker compose already blocks
  // missing values via `${VAR:?...}`; this is defense in depth for `pnpm dev`
  // paths and for anyone running the api outside compose. Symmetric enforcement
  // (compose + startup-check) satisfies security.md item 1 for datastore creds.
  assertStrongDatastoreCred('POSTGRES_PASSWORD', process.env.POSTGRES_PASSWORD);
  assertStrongDatastoreCred('MINIO_ROOT_PASSWORD', process.env.MINIO_ROOT_PASSWORD);
  if (process.env.REDIS_PASSWORD !== undefined) {
    assertStrongDatastoreCred('REDIS_PASSWORD', process.env.REDIS_PASSWORD);
  }
  // === end A-infra ===

  requireEnv('DATABASE_URL');
  requireEnv('REDIS_URL');

  if (isProd) {
    if (!process.env.TRUSTED_ORIGINS) {
      throw new Error('TRUSTED_ORIGINS must be set in production.');
    }
    if (!/sslmode=(require|verify-ca|verify-full)/.test(process.env.DATABASE_URL ?? '')) {
      throw new Error('DATABASE_URL must use TLS in production (sslmode=require or higher).');
    }
  }
}

function requireEnv(name: string): void {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

// A-H9: known-weak datastore credentials. Any of these = refuse boot.
// Lower-cased on match. Adding new entries is welcome; removing = code review.
const WEAK_DATASTORE_CREDS = new Set([
  '',
  'careeros',
  'careerosminio',
  'postgres',
  'admin',
  'password',
  'changeme',
  'minio',
  'minioadmin',
  'root',
  'secret',
  'test',
]);

const MIN_DATASTORE_CRED_BYTES = 24;

/**
 * A-H9: refuse boot on missing, weak-defaulted, or too-short datastore creds.
 * Exported for the unit test only.
 */
export function assertStrongDatastoreCred(name: string, value: string | undefined): void {
  if (!value) {
    throw new Error(
      `${name} is required. Generate one with: openssl rand -base64 32 (A-H9).`,
    );
  }
  if (WEAK_DATASTORE_CREDS.has(value.trim().toLowerCase())) {
    throw new Error(
      `${name} is set to a known-weak default. Generate one with: openssl rand -base64 32 (A-H9).`,
    );
  }
  if (Buffer.byteLength(value, 'utf8') < MIN_DATASTORE_CRED_BYTES) {
    throw new Error(
      `${name} is too short (< ${MIN_DATASTORE_CRED_BYTES} bytes). ` +
        `Generate one with: openssl rand -base64 32 (A-H9).`,
    );
  }
}
