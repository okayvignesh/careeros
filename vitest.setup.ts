// Vitest global setup: seed test-only env vars that side-effect at import time.
// The api boots secrets/prisma at module scope; without a strong ENCRYPTION_KEY
// the test worker crashes before any assertion runs.
process.env.ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.QDRANT_URL ??= 'http://localhost:6333';
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
