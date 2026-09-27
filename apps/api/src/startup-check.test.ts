import { describe, expect, it } from 'vitest';
import { assertStrongDatastoreCred } from './startup-check';

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
