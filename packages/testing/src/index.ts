// @careeros/testing — shared helpers for the four test types that need
// something beyond plain Vitest: Testcontainers (integration), MSW (unit),
// Playwright storage-state + axe (e2e/a11y), fast-check (property).
//
// Each helper is a single small file; consumers import what they need.
// See README.md for one-page usage.
export { startInfra, isDockerAvailable } from './testcontainers';
export type { StartedInfra, StartInfraOptions } from './testcontainers';
export { createMswServer, defaultHandlers } from './msw-server';
export type { MswServer } from './msw-server';
export { seedStorageState } from './playwright-storage-state';
export type { StorageStateOptions } from './playwright-storage-state';
export { runA11y } from './axe-checker';
export type { A11yOptions } from './axe-checker';
export * as arbitraries from './fast-check-arbitraries';
export { resetDb } from './db-reset';
export type { HasRawSql } from './db-reset';
