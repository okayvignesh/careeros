/**
 * A-M2: single global Postgres advisory-lock key guarding "create the first
 * account". `/setup/account` and `/auth/sign-up` both serialize on this so only
 * one concurrent request can pass the `user.count() === 0` check + insert.
 */
export const FIRST_ACCOUNT_ADVISORY_KEY = 1;
