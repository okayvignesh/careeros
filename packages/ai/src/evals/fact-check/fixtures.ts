// C-P4.7e: fixtures for the fact-check gate eval.
//
// Each fixture is a small, human-labeled test of the gate's "given N claims
// and a fact base, how many are supported / dropped" contract. The mock
// provider (in fact-check.eval.ts) returns exactly the verdict pattern named
// by `expected.verdicts` so this suite exercises fixtures + judge + gate
// wiring end-to-end. Live-mode swaps the provider for a real LLM and the
// judge scores drift.
//
// Categories (per plan spec):
//   - all-supported: every claim matches a fact
//   - all-hallucinated: every claim invents beyond the facts
//   - mixed: some supported, some not
//   - near-match / paraphrase: claim rephrases the fact — should support
//   - synonym-match: claim uses a synonym present in the fact — should support
//   - missing-citation: claim has a real fact base but the verdict list omits it

export interface FactCheckFixture {
  id: string;
  category:
    | 'all-supported'
    | 'all-hallucinated'
    | 'mixed'
    | 'near-match'
    | 'synonym-match'
    | 'missing-citation';
  claims: Array<{ text: string; factRefs: string[] }>;
  factBase: Array<{ id: string; kind: string; summary: string }>;
  expected: {
    keptCount: number;
    droppedCount: number;
    hallucinationRate: number; // droppedCount / total
    // Which claim indices the reference model marks supported. The mock
    // provider emits `supported=true` for exactly this set. Missing indices
    // are absent from the verdict map (caller drops = missing = false).
    supportedIndices: number[];
  };
}

const FACTS_EMPLOYMENT = [
  { id: 'e1', kind: 'employment', summary: 'SRE Lead @Acme 2022-2025 ran a postgres fleet' },
  { id: 'e2', kind: 'employment', summary: 'Backend eng @Beta 2019-2022 built a Go service' },
];

const FACTS_COMPANY = [
  { id: 'c1', kind: 'company-page', summary: 'AmbitionBox rating 3.9 across 512 reviews.' },
  { id: 'c2', kind: 'company-page', summary: 'Series C round of $50M raised in 2024.' },
];

const FACTS_JOB = [
  { id: 'j1', kind: 'job', summary: 'Senior Backend Engineer @Acme' },
  { id: 'j2', kind: 'job', summary: 'Staff Platform Engineer @Globex' },
];

export const FACT_CHECK_FIXTURES: FactCheckFixture[] = [
  // ---------- all-supported ----------
  {
    id: 'all-supported-employment',
    category: 'all-supported',
    factBase: FACTS_EMPLOYMENT,
    claims: [
      { text: 'Led SRE work at Acme.', factRefs: ['e1'] },
      { text: 'Wrote a Go service at Beta.', factRefs: ['e2'] },
    ],
    expected: { keptCount: 2, droppedCount: 0, hallucinationRate: 0, supportedIndices: [0, 1] },
  },
  {
    id: 'all-supported-company',
    category: 'all-supported',
    factBase: FACTS_COMPANY,
    claims: [
      { text: 'AmbitionBox rating is 3.9 across 512 reviews.', factRefs: ['c1'] },
      { text: 'Raised a $50M Series C in 2024.', factRefs: ['c2'] },
    ],
    expected: { keptCount: 2, droppedCount: 0, hallucinationRate: 0, supportedIndices: [0, 1] },
  },
  {
    id: 'all-supported-job-market',
    category: 'all-supported',
    factBase: FACTS_JOB,
    claims: [
      { text: 'Acme is hiring Senior Backend Engineers.', factRefs: ['j1'] },
      { text: 'Globex has a Staff Platform role open.', factRefs: ['j2'] },
    ],
    expected: { keptCount: 2, droppedCount: 0, hallucinationRate: 0, supportedIndices: [0, 1] },
  },

  // ---------- all-hallucinated ----------
  {
    id: 'all-hallucinated-employment',
    category: 'all-hallucinated',
    factBase: FACTS_EMPLOYMENT,
    claims: [
      { text: 'Won a Nobel prize in 2020.', factRefs: ['e1'] },
      { text: 'Founded three startups.', factRefs: ['e2'] },
    ],
    expected: { keptCount: 0, droppedCount: 2, hallucinationRate: 1, supportedIndices: [] },
  },
  {
    id: 'all-hallucinated-metrics',
    category: 'all-hallucinated',
    factBase: FACTS_EMPLOYMENT,
    claims: [
      { text: 'Cut latency by 80% at Acme.', factRefs: ['e1'] },
      { text: 'Scaled Beta service to 100k RPS.', factRefs: ['e2'] },
    ],
    expected: { keptCount: 0, droppedCount: 2, hallucinationRate: 1, supportedIndices: [] },
  },
  {
    id: 'all-hallucinated-company',
    category: 'all-hallucinated',
    factBase: FACTS_COMPANY,
    claims: [
      { text: 'Rated 4.8 stars on AmbitionBox.', factRefs: ['c1'] },
      { text: 'Series D of $200M closed last month.', factRefs: ['c2'] },
    ],
    expected: { keptCount: 0, droppedCount: 2, hallucinationRate: 1, supportedIndices: [] },
  },

  // ---------- mixed ----------
  {
    id: 'mixed-half',
    category: 'mixed',
    factBase: FACTS_EMPLOYMENT,
    claims: [
      { text: 'Led SRE work at Acme.', factRefs: ['e1'] },
      { text: 'Managed a 50-person engineering org.', factRefs: ['e1'] },
      { text: 'Wrote a Go service at Beta.', factRefs: ['e2'] },
      { text: 'Shipped iOS apps at Beta.', factRefs: ['e2'] },
    ],
    expected: { keptCount: 2, droppedCount: 2, hallucinationRate: 0.5, supportedIndices: [0, 2] },
  },
  {
    id: 'mixed-mostly-good',
    category: 'mixed',
    factBase: FACTS_COMPANY,
    claims: [
      { text: 'AmbitionBox rating 3.9.', factRefs: ['c1'] },
      { text: '512 reviews on AmbitionBox.', factRefs: ['c1'] },
      { text: 'Series C in 2024.', factRefs: ['c2'] },
      { text: 'Fortune 500 company since 1999.', factRefs: ['c2'] },
    ],
    expected: { keptCount: 3, droppedCount: 1, hallucinationRate: 0.25, supportedIndices: [0, 1, 2] },
  },
  {
    id: 'mixed-mostly-bad',
    category: 'mixed',
    factBase: FACTS_EMPLOYMENT,
    claims: [
      { text: 'Led SRE work at Acme.', factRefs: ['e1'] },
      { text: 'Sole author of the Postgres source code.', factRefs: ['e1'] },
      { text: 'Founded Kubernetes.', factRefs: ['e1'] },
    ],
    expected: { keptCount: 1, droppedCount: 2, hallucinationRate: 2 / 3, supportedIndices: [0] },
  },

  // ---------- near-match / paraphrase ----------
  {
    id: 'near-match-postgres',
    category: 'near-match',
    factBase: FACTS_EMPLOYMENT,
    claims: [
      // Fact says "ran a postgres fleet"; claim paraphrases.
      { text: 'Operated Postgres in production at Acme.', factRefs: ['e1'] },
    ],
    expected: { keptCount: 1, droppedCount: 0, hallucinationRate: 0, supportedIndices: [0] },
  },
  {
    id: 'near-match-rounded-metric',
    category: 'near-match',
    factBase: FACTS_COMPANY,
    claims: [
      // Fact says "3.9 across 512 reviews"; claim rounds to "~500 reviews".
      { text: 'AmbitionBox shows about 500 reviews at 3.9 stars.', factRefs: ['c1'] },
    ],
    expected: { keptCount: 1, droppedCount: 0, hallucinationRate: 0, supportedIndices: [0] },
  },

  // ---------- synonym-match ----------
  {
    id: 'synonym-eng-vs-dev',
    category: 'synonym-match',
    factBase: FACTS_JOB,
    claims: [
      // Fact uses "Backend Engineer"; claim uses "Backend Developer".
      { text: 'Acme is hiring a Senior Backend Developer.', factRefs: ['j1'] },
    ],
    expected: { keptCount: 1, droppedCount: 0, hallucinationRate: 0, supportedIndices: [0] },
  },
  {
    id: 'synonym-raised-vs-closed',
    category: 'synonym-match',
    factBase: FACTS_COMPANY,
    claims: [
      // Fact: "raised"; claim uses "closed".
      { text: 'Closed a $50M Series C in 2024.', factRefs: ['c2'] },
    ],
    expected: { keptCount: 1, droppedCount: 0, hallucinationRate: 0, supportedIndices: [0] },
  },

  // ---------- missing-citation ----------
  {
    id: 'missing-citation-single',
    category: 'missing-citation',
    factBase: FACTS_EMPLOYMENT,
    claims: [
      { text: 'Led SRE work at Acme.', factRefs: ['e1'] },
      { text: 'Wrote a Go service at Beta.', factRefs: ['e2'] },
    ],
    // Auditor forgot to score claim 1 → missing verdict = drop.
    expected: { keptCount: 1, droppedCount: 1, hallucinationRate: 0.5, supportedIndices: [0] },
  },
  {
    id: 'missing-citation-all',
    category: 'missing-citation',
    factBase: FACTS_EMPLOYMENT,
    claims: [
      { text: 'A.', factRefs: ['e1'] },
      { text: 'B.', factRefs: ['e2'] },
    ],
    // Auditor returned zero verdicts → everything drops.
    expected: { keptCount: 0, droppedCount: 2, hallucinationRate: 1, supportedIndices: [] },
  },
];

// Fixture count enforcement per spec (15+).
if (FACT_CHECK_FIXTURES.length < 15) {
  throw new Error(
    `fact-check fixtures: need >= 15, have ${FACT_CHECK_FIXTURES.length}`,
  );
}
