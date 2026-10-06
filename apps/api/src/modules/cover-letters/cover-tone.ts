import { BadRequestException } from '@nestjs/common';

/**
 * Cover-letter tone is a closed enum selected IN CODE from the targeting
 * profile — never by the LLM (job-targeting-design.md §9). The service passes
 * the chosen value into the prompt as `{{tone}}`; the model only echoes it.
 */
export const COVER_TONES = ['professional', 'concise', 'enthusiastic', 'warm'] as const;
export type CoverTone = (typeof COVER_TONES)[number];

export function isCoverTone(value: string): value is CoverTone {
  return (COVER_TONES as readonly string[]).includes(value);
}

export interface ToneSelectionInput {
  /** Profile seniority tokens (`intern|junior|mid|senior|staff|principal|manager`). */
  seniority: string[];
  relocationWilling: boolean;
  /** Explicit UI override; validated against the enum, 400 on unknown. */
  explicit?: string;
}

/**
 * Deterministic tone choice:
 *   staff/principal → concise (senior audience, signal-dense)
 *   senior/manager  → professional
 *   relocation      → warm (cross-border move benefits a human register)
 *   otherwise       → enthusiastic (early/mid career)
 * An explicit, valid override always wins; an invalid one is a 400.
 */
export function selectCoverTone(input: ToneSelectionInput): CoverTone {
  if (input.explicit !== undefined) {
    if (!isCoverTone(input.explicit)) {
      throw new BadRequestException(`Unknown cover-letter tone: ${input.explicit}`);
    }
    return input.explicit;
  }
  const seniority = new Set(input.seniority);
  if (seniority.has('staff') || seniority.has('principal')) return 'concise';
  if (seniority.has('senior') || seniority.has('manager')) return 'professional';
  if (input.relocationWilling) return 'warm';
  return 'enthusiastic';
}
