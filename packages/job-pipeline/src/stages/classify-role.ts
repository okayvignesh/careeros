/**
 * Role classifier: title + description → job family.
 *
 * ponytail: keyword-weight heuristic, not ML. Each family owns a bag of tokens
 * (title-weight 3, description-weight 1). Family with the highest score wins.
 * Ties → 'fullstack' if frontend + backend both fired, otherwise the first
 * family in the tie. Upgrade path: switch to embedding-similarity against a
 * seeded family taxonomy once misclassification rate crosses ~10%.
 */

export type RoleFamily =
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'mobile'
  | 'devops'
  | 'sre'
  | 'data'
  | 'ml'
  | 'security'
  | 'pm'
  | 'design'
  | 'manager';

export interface RoleResult {
  family: RoleFamily;
  subFamily?: string;
  confidence: number;
  reasons: string[];
}

interface FamilySignals {
  family: RoleFamily;
  title: RegExp[];
  description: RegExp[];
}

const SIGNALS: FamilySignals[] = [
  {
    family: 'frontend',
    title: [/\bfront[-\s]?end\b|\bfe\b|\bui\s+engineer\b|\bweb\s+engineer\b/i],
    description: [/\b(react|vue|angular|svelte|next\.?js|tailwind|css|typescript\s+react|htmx)\b/i],
  },
  {
    family: 'backend',
    title: [/\bback[-\s]?end\b|\bbe\b|\bapi\s+engineer\b|\bplatform\s+engineer\b|\bserver\s+engineer\b/i],
    description: [/\b(node\.?js|django|rails|spring|fastapi|postgres(?:ql)?|mysql|graphql|rest\s+api|grpc|kafka)\b/i],
  },
  {
    family: 'fullstack',
    title: [/\bfull[-\s]?stack\b/i],
    description: [/\bfull[-\s]?stack\b|\bend[-\s]to[-\s]end\s+features?\b/i],
  },
  {
    family: 'mobile',
    title: [/\b(ios|android|mobile|react\s*native|flutter)\s*(engineer|developer|dev)?\b/i],
    description: [/\b(swift|kotlin|objective[-\s]?c|jetpack\s+compose|swiftui|react\s+native|flutter|xamarin)\b/i],
  },
  {
    family: 'devops',
    title: [/\b(devops|platform\s+ops|infra(?:structure)?\s+engineer|cloud\s+engineer)\b/i],
    description: [/\b(terraform|ansible|kubernetes|k8s|docker|helm|argocd|ci\/cd|jenkins|github\s+actions)\b/i],
  },
  {
    family: 'sre',
    title: [/\bsre\b|\bsite\s+reliability\b|\bproduction\s+engineer\b/i],
    description: [/\b(slo|sli|error\s+budget|on[-\s]call|incident\s+response|prometheus|grafana|observability)\b/i],
  },
  {
    family: 'data',
    title: [/\bdata\s+(engineer|analyst|scientist)\b|\banalytics\s+engineer\b|\bbi\s+engineer\b/i],
    description: [/\b(airflow|dbt|snowflake|bigquery|redshift|spark|hadoop|etl|elt|data\s+warehouse|dimensional\s+model)\b/i],
  },
  {
    family: 'ml',
    title: [/\b(ml|machine\s+learning|ai|research)\s+(engineer|scientist)\b|\bmlops\b|\bapplied\s+scientist\b/i],
    description: [/\b(pytorch|tensorflow|jax|scikit[-\s]?learn|transformer|llm|rag|embedding|feature\s+store|mlflow)\b/i],
  },
  {
    family: 'security',
    title: [/\b(security|appsec|infosec|red\s+team|blue\s+team)\s+(engineer|architect)?\b/i],
    description: [/\b(threat\s+model|pentest|vulnerability|owasp|cve|siem|iam|zero[-\s]trust|soc\s*2|iso\s*27001)\b/i],
  },
  {
    family: 'pm',
    title: [/\b(product\s+manager|pm|tpm|technical\s+program\s+manager|product\s+owner)\b/i],
    description: [/\b(roadmap|prd|product\s+requirements|stakeholder|prioritization|user\s+research|ab\s+test)\b/i],
  },
  {
    family: 'design',
    title: [/\b(designer|ux|ui|product\s+design|design\s+engineer|design\s+lead)\b/i],
    description: [/\b(figma|sketch|prototyping|user\s+research|design\s+system|wireframe|usability)\b/i],
  },
  {
    family: 'manager',
    title: [/\b(engineering\s+manager|em\b|people\s+manager|director\s+of\s+engineering|senior\s+manager)\b/i],
    description: [/\b(direct\s+reports|1:1s?|manage\s+a\s+team|hire\s+and\s+grow|people\s+manager|performance\s+reviews?)\b/i],
  },
];

const TITLE_WEIGHT = 3;
const DESC_WEIGHT = 1;

/**
 * Classify job family. Score every family by (title-matches * 3 + desc-matches * 1);
 * highest wins. Tie between frontend and backend → fullstack. All ties otherwise
 * take the earliest-declared family. No signal at all → 'backend' at 0.2 conf
 * (the largest family in most real corpora — safe default).
 */
export function classifyRole(title: string, description = ''): RoleResult {
  const descPrefix = description.slice(0, 2000);
  const reasons: string[] = [];
  const scores = new Map<RoleFamily, number>();

  for (const sig of SIGNALS) {
    let score = 0;
    if (sig.title.some((re) => re.test(title))) {
      score += TITLE_WEIGHT;
      reasons.push(`title matched ${sig.family}`);
    }
    if (sig.description.some((re) => re.test(descPrefix))) {
      score += DESC_WEIGHT;
      reasons.push(`description matched ${sig.family}`);
    }
    if (score > 0) scores.set(sig.family, score);
  }

  if (scores.size === 0) {
    return { family: 'backend', confidence: 0.2, reasons: ['no signal — default backend'] };
  }

  // Highest score wins.
  let best: RoleFamily = 'backend';
  let bestScore = -1;
  for (const [fam, s] of scores) {
    if (s > bestScore) { best = fam; bestScore = s; }
  }

  // Fullstack override: if both frontend and backend fired and neither strictly
  // beats the other, prefer fullstack.
  const fe = scores.get('frontend') ?? 0;
  const be = scores.get('backend') ?? 0;
  const fs = scores.get('fullstack') ?? 0;
  if (fe > 0 && be > 0 && fs === 0 && Math.abs(fe - be) <= 1) {
    best = 'fullstack';
    reasons.push('frontend + backend both fired → fullstack');
    bestScore = Math.max(fe, be);
  }

  // Confidence: normalized to max possible (title + all descs). Cap at 0.95.
  const confidence = Math.min(0.95, 0.3 + bestScore * 0.15);
  return { family: best, confidence, reasons };
}
