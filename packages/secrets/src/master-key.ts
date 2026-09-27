const WEAK_SET = new Set([
  '',
  'changeme',
  'REPLACE_ME_WITH_openssl_rand_hex_32',
  '00000000000000000000000000000000',
  '0'.repeat(64),
]);

/** Refuses to start on weak or missing key. Called during startup-check before Nest bootstrap. */
export function assertStrongKey(name: string, value: string | undefined, minBytes = 32): void {
  if (!value || WEAK_SET.has(value.trim())) {
    throw new Error(
      `${name} is missing or set to a known-weak value. Generate one with: openssl rand -hex 32`,
    );
  }
  const bytes = value.length >= 64 ? Buffer.from(value, 'hex').length : Buffer.byteLength(value);
  if (bytes < minBytes) {
    throw new Error(`${name} is too short (${bytes} bytes). Need at least ${minBytes} bytes.`);
  }
}

export function loadMasterKey(env = process.env.ENCRYPTION_KEY): Buffer {
  assertStrongKey('ENCRYPTION_KEY', env);
  const value = env!;
  return value.length >= 64 && /^[0-9a-f]+$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value.padEnd(32, '\0').slice(0, 32), 'utf8');
}
