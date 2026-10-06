import { BadRequestException } from '@nestjs/common';
import { countryByCode, type Region } from '@careeros/shared';
import {
  parseTemplateId,
  regionToTemplate,
  type ResumeContact,
  type TemplateId,
} from '@careeros/resume-render';

/**
 * Deterministic targeting-context resolution for P2b resume/cover tailoring.
 *
 * Everything here is pure code over closed vocabularies — the targeting
 * profile, the job's structured geo, and the template/tone enums. No LLM is
 * asked to pick a role, region, template, or tone (job-targeting-design.md §9).
 *
 * Lives beside the resume service and is imported by the cover-letter service
 * so both generators resolve the SAME context from the SAME profile.
 */

/** The slice of `user_job_preferences` that tailoring reads. */
export interface TargetingProfile {
  targetRoles: string[];
  countries: string[];
  homeCountry: string | null;
  seniority: string[];
  relocationWilling: boolean;
  relocationCountries: string[];
}

/** The slice of a normalized job that tailoring reads. */
export interface TargetingJob {
  title: string;
  country: string | null;
}

export interface TargetingContext {
  /** Profile override when present, else the raw posting title. */
  targetRole: string;
  /** Human-readable target market label (country name or a neutral default). */
  targetMarket: string;
  /** Coarse region from the profile/job country, or null when unknown. */
  region: Region | null;
  /** Code-selected template (region mapping) or an explicit valid override. */
  templateId: TemplateId;
}

export const EMPTY_TARGETING_PROFILE: TargetingProfile = {
  targetRoles: [],
  countries: [],
  homeCountry: null,
  seniority: [],
  relocationWilling: false,
  relocationCountries: [],
};

function firstNonEmpty(values: readonly string[] | null | undefined): string | null {
  if (!values) return null;
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

function regionOf(countryCode: string | null | undefined): Region | null {
  if (!countryCode) return null;
  return countryByCode(countryCode)?.region ?? null;
}

/**
 * Resolve the tailoring context. An explicit `template` override (from a real
 * UI control) is validated against the closed id vocabulary and wins over the
 * region mapping; an unknown override is a 400 rather than a silent fallback.
 */
export function resolveTargetingContext(
  profile: TargetingProfile,
  job: TargetingJob,
  opts: { template?: string } = {},
): TargetingContext {
  let templateId: TemplateId | null = null;
  if (opts.template !== undefined) {
    templateId = parseTemplateId(opts.template);
    if (!templateId) throw new BadRequestException(`Unknown resume template: ${opts.template}`);
  }

  const targetRole = firstNonEmpty(profile.targetRoles) ?? job.title;

  const region =
    regionOf(firstNonEmpty(profile.countries)) ??
    regionOf(job.country) ??
    regionOf(profile.homeCountry) ??
    null;

  if (templateId === null) templateId = regionToTemplate(region);

  const marketCountry =
    firstNonEmpty(profile.countries) ?? job.country ?? profile.homeCountry ?? null;
  const targetMarket = marketCountry
    ? (countryByCode(marketCountry)?.name ?? marketCountry)
    : 'Global / remote';

  return { targetRole, targetMarket, region, templateId };
}

/** A verified resume fact as read for contact extraction. */
export interface ContactFact {
  kind: string;
  content: unknown;
}

/**
 * Build the `ResumeDoc` contact block from VERIFIED facts only (AGENTS §2).
 * Returns `undefined` when no fact supplies a field — the renderer then draws
 * no contact line rather than a fabricated address. Values are copied verbatim;
 * nothing is inferred, normalized into an address, or defaulted.
 */
export function buildResumeContact(facts: readonly ContactFact[]): ResumeContact | undefined {
  const contact: ResumeContact = {};
  for (const fact of facts) {
    if (!fact.content || typeof fact.content !== 'object') continue;
    const content = fact.content as Record<string, unknown>;
    if (fact.kind === 'location' && typeof content.text === 'string' && !contact.location) {
      contact.location = content.text;
    }
    if (fact.kind === 'headline' && typeof content.text === 'string' && !contact.headline) {
      contact.headline = content.text;
    }
    if (fact.kind === 'contact' || fact.kind === 'personal') {
      if (typeof content.name === 'string' && !contact.name) contact.name = content.name;
      if (typeof content.email === 'string' && !contact.email) contact.email = content.email;
      if (typeof content.location === 'string' && !contact.location) {
        contact.location = content.location;
      }
    }
  }
  return Object.keys(contact).length > 0 ? contact : undefined;
}
