// Env-driven app config stubs. Intentionally tiny: no DI, no class, just
// parse functions callers import directly. New config values go here when
// they outgrow a single call site.
//
// security.md item 6 (zero telemetry by default): USAGE_STATS is the
// kill-switch for a future opt-in telemetry channel. Today it does NOT
// transmit anything. Reading it from code is how we prove that the
// transport, when it lands, cannot flip on by accident: callers must call
// getUsageStatsConfig() and respect `enabled`.

export type UsageStatsConfig = {
  /** True only when operator has explicitly opted in via `USAGE_STATS=on`. */
  enabled: boolean;
  /** Raw value as read from env, lower-cased + trimmed. */
  rawValue: 'on' | 'off';
};

/**
 * Parse the USAGE_STATS env var. Accepts `on` | `off` | unset (treated as
 * `off`). Any other value throws so startup-check refuses to boot — fail
 * loud over silently defaulting to off (that way an operator who typo'd
 * `USAGE_STATS=true` finds out immediately instead of thinking they opted in).
 *
 * No network side effects. ponytail: real transport lives in the (future)
 * telemetry module; this helper is the single read point so adding it is
 * a one-line wire-up.
 */
export function getUsageStatsConfig(
  env: NodeJS.ProcessEnv = process.env,
): UsageStatsConfig {
  const raw = env.USAGE_STATS;
  if (raw === undefined || raw === '') {
    return { enabled: false, rawValue: 'off' };
  }
  const normalised = raw.trim().toLowerCase();
  if (normalised === 'on') return { enabled: true, rawValue: 'on' };
  if (normalised === 'off') return { enabled: false, rawValue: 'off' };
  throw new Error(
    `USAGE_STATS must be 'on' or 'off' (got '${raw}'). See docs/security.md item 6.`,
  );
}
