// F.5 (Wave F / P6): outreach template library.
//
// Five template families x three industry variants (+ default). Templates
// are prompts scaffolds - a base persona + tone directive + skeleton for
// the composer prompt to fill in. The LLM never sees the raw skeleton;
// it sees the rendered "guidance" block that steers the draft.
//
// Adding a new template = one entry here + one const in OUTREACH_TEMPLATE_IDS
// (import-time check) + a fixture in the eval suite once it lands.

export const OUTREACH_TEMPLATE_IDS = [
  'cold-reach',
  'warm-referral',
  'event-followup',
  'alumni-connection',
  'application-followup',
] as const;
export type OutreachTemplateId = (typeof OUTREACH_TEMPLATE_IDS)[number];

export const INDUSTRY_VARIANTS = ['default', 'startup', 'enterprise', 'academia'] as const;
export type IndustryVariant = (typeof INDUSTRY_VARIANTS)[number];

export interface OutreachTemplate {
  id: OutreachTemplateId;
  displayName: string;
  version: string;
  /** One line the composer prompt uses as the base persona / tone. */
  personaLine: string;
  /** Two-to-four bullet skeleton the composer fills in. */
  skeleton: string[];
  /** Per-industry tone hints. `default` is the fallback. */
  variantHints: Record<IndustryVariant, string>;
}

export const OUTREACH_TEMPLATES: Record<OutreachTemplateId, OutreachTemplate> = {
  'cold-reach': {
    id: 'cold-reach',
    displayName: 'Cold reach out',
    version: '1.0.0',
    personaLine: 'Curious, respectful, and briefly credentialed - never salesy.',
    skeleton: [
      'Why you (one specific reason from company/role signal)',
      'Why me (one line grounded in evidence)',
      'The ask (15 min chat OR a pointer to the right person)',
    ],
    variantHints: {
      default: 'Neutral professional tone.',
      startup: 'Direct, low-fluff, mention traction or product angle.',
      enterprise: 'Formal, reference program/team explicitly, acknowledge process.',
      academia: 'Cite one relevant paper or lab thread, longer email OK.',
    },
  },
  'warm-referral': {
    id: 'warm-referral',
    displayName: 'Warm referral (mutual contact intro)',
    version: '1.0.0',
    personaLine: 'Grateful to the connector, concise about the ask.',
    skeleton: [
      'Name the mutual contact and how they referred you',
      'The role and why it fits',
      'The ask (call / next step / referral inside the company)',
    ],
    variantHints: {
      default: 'Warm but efficient.',
      startup: 'Include a link to a project or portfolio piece.',
      enterprise: 'Mention explicit team + hiring manager if known.',
      academia: 'Reference the introducing colleague professionally.',
    },
  },
  'event-followup': {
    id: 'event-followup',
    displayName: 'Post-event / conference follow-up',
    version: '1.0.0',
    personaLine: 'Genuine, references the actual event moment.',
    skeleton: [
      'Where you met + one specific thing they said',
      'What resonated + how it connects to what you do',
      'The next step (talk more / project / role interest)',
    ],
    variantHints: {
      default: 'Casual but polished.',
      startup: 'Skip pleasantries; get to the substance.',
      enterprise: 'Reference the panel/session by name.',
      academia: 'Cite the exact paper/talk + one question.',
    },
  },
  'alumni-connection': {
    id: 'alumni-connection',
    displayName: 'Alumni network introduction',
    version: '1.0.0',
    personaLine: 'Peer-to-peer, no false intimacy.',
    skeleton: [
      'Alumni context (school/program/year)',
      'Why now + what you are exploring',
      'A specific ask they can actually help with in <10 min',
    ],
    variantHints: {
      default: 'Warm and specific.',
      startup: 'Mention founding team overlap if any.',
      enterprise: 'Reference internal program or track.',
      academia: 'Reference the advisor or lab that connects you.',
    },
  },
  'application-followup': {
    id: 'application-followup',
    displayName: 'Application follow-up',
    version: '1.0.0',
    personaLine: 'Confident, not pushy - one round of nudge only.',
    skeleton: [
      'Reference the application date + role',
      'One line reinforcing the strongest fit signal',
      'Direct ask: status update OR contact of the right recruiter',
    ],
    variantHints: {
      default: 'Polite persistence.',
      startup: 'One-liner + link to code / demo.',
      enterprise: 'Cite the requisition ID if known.',
      academia: 'Note the search-committee cadence gracefully.',
    },
  },
};

/** Look-up helper that throws on unknown id (import-time safety net). */
export function getOutreachTemplate(id: string): OutreachTemplate {
  if (!OUTREACH_TEMPLATE_IDS.includes(id as OutreachTemplateId)) {
    throw new Error(`Unknown outreach template: ${id}`);
  }
  return OUTREACH_TEMPLATES[id as OutreachTemplateId];
}

/**
 * F.5 send-timing: nearest business-hours slot in the recipient's tz.
 * Business hours = 09:00-17:00 local. If `nowUtc` is inside that window
 * in tz, returns nowUtc; else advances to the next 09:00 local.
 * Weekends round up to Monday 09:00.
 */
export function nextBusinessHourSlot(tz: string, nowUtc: Date = new Date()): Date {
  // Extract local wall-clock via Intl.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(nowUtc);
  const partMap: Record<string, string> = {};
  for (const p of parts) partMap[p.type] = p.value;
  const weekday = partMap.weekday ?? 'Mon';
  const hour = Number(partMap.hour ?? '0');
  const minute = Number(partMap.minute ?? '0');
  const localSec = hour * 3600 + minute * 60;

  const dayShift = weekendDayShift(weekday, hour);
  if (dayShift === 0 && localSec >= 9 * 3600 && localSec < 17 * 3600) {
    return nowUtc;
  }
  // Advance to next weekday-9am local.
  const target9 = 9 * 3600;
  let deltaSec = target9 - localSec;
  if (deltaSec <= 0 || dayShift > 0) deltaSec += 86_400 * (dayShift > 0 ? dayShift : 1);
  return new Date(nowUtc.getTime() + deltaSec * 1000);
}

function weekendDayShift(weekday: string, hour: number): number {
  // If we are on Saturday any hour or Sunday any hour, advance to Monday.
  // If Friday >= 17, advance to Monday.
  if (weekday === 'Sat') return 2;
  if (weekday === 'Sun') return 1;
  if (weekday === 'Fri' && hour >= 17) return 3;
  return 0;
}
