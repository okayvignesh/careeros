/**
 * Deterministic region → template selection + template-id normalization.
 *
 * Region and template are picked IN CODE from closed vocabularies — never by an
 * LLM (job-targeting-design.md §9). Lives in `resume-render` (not `shared`) so
 * `shared` is not coupled to template ids, and so the mapping cannot be imported
 * by browser bundles that have no renderer.
 *
 * The DB has legacy defaults (`resume_variants.templateId` defaults `ats-first`,
 * `cover_letters.templateId` defaults `standard`) while `TemplateId` is
 * `classic|dense-tech|modern-minimal|international`. `parseTemplateId` bridges
 * the two and `normalizeTemplateId` adds a safe default for render paths.
 */
import type { TemplateId } from './types';

/** Every selectable template id. Keep in sync with `templates/index.ts`. */
export const RESUME_TEMPLATE_IDS = [
  'classic',
  'dense-tech',
  'modern-minimal',
  'international',
] as const satisfies readonly TemplateId[];

/**
 * Region → template. North America keeps the LETTER-size ATS baseline; every
 * other region gets the A4 international layout (contact block, A4 paper),
 * which is the common convention for EU/APAC/MEA applications.
 */
export const RESUME_REGION_TEMPLATE_MAP: Record<string, TemplateId> = {
  north_america: 'classic',
  south_america: 'international',
  europe: 'international',
  africa: 'international',
  middle_east: 'international',
  asia_pacific: 'international',
};

/**
 * Map a coarse region (from `@careeros/shared` geo primitives) to a template.
 * Unknown/absent region falls back to the ATS baseline — never throws.
 */
export function regionToTemplate(region: string | null | undefined): TemplateId {
  if (!region) return 'classic';
  return RESUME_REGION_TEMPLATE_MAP[region] ?? 'classic';
}

/** Legacy/ambiguous ids → canonical `TemplateId`. */
const TEMPLATE_ALIASES: Record<string, TemplateId> = {
  'ats-first': 'classic',
  ats: 'classic',
  standard: 'classic',
  default: 'classic',
  classic: 'classic',
  'dense-tech': 'dense-tech',
  dense: 'dense-tech',
  'modern-minimal': 'modern-minimal',
  modern: 'modern-minimal',
  international: 'international',
  europass: 'international',
};

/** Resolve a raw template id (incl. legacy aliases) or `null` when unknown. */
export function parseTemplateId(raw: string | null | undefined): TemplateId | null {
  if (raw === null || raw === undefined) return null;
  return TEMPLATE_ALIASES[raw] ?? null;
}

/** Parse with a safe fallback to the ATS baseline (for persisted rows). */
export function normalizeTemplateId(raw: string | null | undefined): TemplateId {
  return parseTemplateId(raw) ?? 'classic';
}
