import { assertStrongKey } from '@careeros/secrets';

/**
 * Refuses to start if required env is missing or weak.
 * Runs before Nest bootstrap. Any failure → process exit 1 with clear message.
 */
export function runStartupChecks(): void {
  const isProd = process.env.NODE_ENV === 'production';

  assertStrongKey('ENCRYPTION_KEY', process.env.ENCRYPTION_KEY);
  assertStrongKey('SESSION_SECRET', process.env.SESSION_SECRET);

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
