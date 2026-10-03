/**
 * Zod boundary for the market-demand endpoints. The API returns envelopes
 * (`{ windowDays, rows }` / `{ generatedAt, signals }`); validating here keeps
 * the components honest — a shape mismatch throws and the panel renders the
 * explicit unavailable state rather than partial/garbage data (A8).
 */
import {
  SkillDemandResponseSchema,
  TrendSignalsResponseSchema,
  type SkillDemandRow,
  type TrendSignal,
} from '@careeros/shared';

export interface SkillDemandView {
  windowDays: number;
  rows: SkillDemandRow[];
  /** Distinct clusters present in the data, alphabetical; drives the filter. */
  clusters: string[];
}

export function skillDemandView(value: unknown): SkillDemandView {
  const parsed = SkillDemandResponseSchema.parse(value);
  const clusters = [...new Set(parsed.rows.map((r) => r.cluster))].sort((a, b) =>
    a.localeCompare(b),
  );
  return { windowDays: parsed.windowDays, rows: parsed.rows, clusters };
}

export interface TrendSignalsView {
  generatedAt: string;
  signals: TrendSignal[];
}

export function trendSignalsView(value: unknown): TrendSignalsView {
  const parsed = TrendSignalsResponseSchema.parse(value);
  return { generatedAt: parsed.generatedAt, signals: parsed.signals };
}
