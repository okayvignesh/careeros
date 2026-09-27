// @careeros/testing — shared helpers for the four test types that need
// something beyond plain Vitest: Testcontainers (integration), MSW (unit),
// Playwright storage-state + axe (e2e/a11y), fast-check (property).
//
// Each helper is a single small file; consumers import what they need.
// See README.md for one-page usage.
export { startInfra, isDockerAvailable } from './testcontainers';
export type { StartedInfra, StartInfraOptions } from './testcontainers';
