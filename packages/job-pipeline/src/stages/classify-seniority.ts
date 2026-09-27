/**
 * Seniority classifier: title + first 500 chars of description → level.
 *
 * ponytail: keyword + regex heuristic, not ML. Job titles are >90% covered by
 * a handful of tokens; the description acts as a tiebreaker for ambiguous
 * titles (e.g. "Software Engineer" alone → mid, unless the desc says "10+
 * years" or "manage a team"). Upgrade path: swap to the `job-seniority`
 * classifier prompt once evals show a real accuracy gap.
 */

export type SeniorityLevel =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'lead'
  | 'manager'
  | 'director'
  | 'vp'
  | 'cxo';

export interface SeniorityResult {
  level: SeniorityLevel;
  confidence: number; // 0..1
  reasons: string[];
}

interface TitleRule {
  level: SeniorityLevel;
  // Match anywhere in the title, case-insensitive. Order in RULES matters —
  // first match wins so put the specific patterns first (e.g. "Senior Manager"
  // beats "Senior" alone).
  re: RegExp;
}

// Order = specificity. "Senior Manager" MUST match before "Senior".
const TITLE_RULES: TitleRule[] = [
  { level: 'cxo',       re: /\b(cto|ceo|coo|cfo|cpo|ciso|chief\s+\w+\s+officer)\b/i },
  { level: 'vp',        re: /\bvp\b|\bvice\s+president\b|\bsvp\b|\bevp\b/i },
  { level: 'director',  re: /\b(director|head\s+of)\b/i },
  { level: 'manager',   re: /\b(senior|sr\.?|principal|staff)\s+manager\b|\bengineering\s+manager\b|\bem\b|\bpeople\s+manager\b|\bmanager\b/i },
  { level: 'principal', re: /\bprincipal\b/i },
  { level: 'staff',     re: /\bstaff\b/i },
  { level: 'lead',      re: /\blead\b|\btech\s+lead\b|\btl\b/i },
  { level: 'senior',    re: /\b(senior|sr\.?|snr\.?)\b/i },
  { level: 'junior',    re: /\b(junior|jr\.?|associate|entry[-\s]?level|graduate|new\s+grad|early\s+career)\b/i },
  { level: 'intern',    re: /\b(intern|internship|co[-\s]?op|apprentice|trainee)\b/i },
];

/**
 * Years-of-experience → seniority band. Highest matching band wins. Bands are
 * inclusive on the lower bound: 0-1 intern/junior, 2-4 mid, 5-8 senior,
 * 9-12 staff, 13+ principal. Numbers pulled from every "5+ years", "at least
 * 8 years", "3-5 years" pattern in the first 500 chars.
 */
function yearsToLevel(years: number): SeniorityLevel | null {
  if (years >= 13) return 'principal';
  if (years >= 9) return 'staff';
  if (years >= 5) return 'senior';
  if (years >= 2) return 'mid';
  if (years >= 0) return 'junior';
  return null;
}

function extractMaxYears(text: string): number | null {
  // Match "5+ years", "5-8 years", "at least 5 years", "minimum of 5 years".
  const re = /(?:at\s+least\s+|minimum\s+(?:of\s+)?)?(\d{1,2})\s*(?:\+|-\s*\d{1,2})?\s*(?:years?|yrs?)/gi;
  let max: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n <= 30) max = max === null ? n : Math.max(max, n);
  }
  return max;
}

function hasManagementLanguage(text: string): boolean {
  return /\b(manage\s+a\s+team|lead\s+a\s+team|own\s+the\s+roadmap|hire\s+and\s+grow|people\s+manager|direct\s+reports|1:1s?|one[-\s]on[-\s]ones?)\b/i.test(text);
}

const LEVEL_RANK: Record<SeniorityLevel, number> = {
  intern: 0, junior: 1, mid: 2, senior: 3, staff: 4, principal: 5,
  lead: 4, manager: 5, director: 6, vp: 7, cxo: 8,
};

/**
 * Classify a job's seniority. Signals in priority order:
 *   1. Title regex (specific → generic). Strongest signal.
 *   2. YOE phrase in first 500 chars of description → band.
 *   3. Management language → floor at staff+ if title said mid/senior.
 * If no signal at all → mid @ 0.2 confidence.
 */
export function classifySeniority(title: string, description = ''): SeniorityResult {
  const reasons: string[] = [];
  const descPrefix = description.slice(0, 500);

  let titleLevel: SeniorityLevel | null = null;
  for (const rule of TITLE_RULES) {
    if (rule.re.test(title)) {
      titleLevel = rule.level;
      reasons.push(`title matched ${rule.level} pattern`);
      break;
    }
  }

  const years = extractMaxYears(descPrefix);
  const yoeLevel = years !== null ? yearsToLevel(years) : null;
  if (yoeLevel && years !== null) {
    reasons.push(`YOE signal: ${years} years → ${yoeLevel}`);
  }

  const mgmt = hasManagementLanguage(descPrefix);
  if (mgmt) reasons.push('management-language in description');

  // Merge: title wins unless YOE points higher.
  let level: SeniorityLevel;
  let confidence: number;
  if (titleLevel && yoeLevel) {
    // Take the higher rank.
    level = LEVEL_RANK[yoeLevel] > LEVEL_RANK[titleLevel] ? yoeLevel : titleLevel;
    confidence = 0.9;
  } else if (titleLevel) {
    level = titleLevel;
    confidence = 0.75;
  } else if (yoeLevel) {
    level = yoeLevel;
    confidence = 0.55;
  } else {
    level = 'mid';
    confidence = 0.2;
    reasons.push('no title or YOE signal — default mid');
  }

  // Management-language floor: bumps a "mid" or "senior" IC-title with mgmt
  // language up to staff. Doesn't touch explicit manager+ titles.
  if (mgmt && (level === 'mid' || level === 'senior') && titleLevel !== 'manager') {
    level = 'staff';
    reasons.push('bumped to staff on management-language');
  }

  return { level, confidence, reasons };
}
