// Worker-side corpus adapter contract. Weekly cron runs each adapter, dedupes
// by exact `promptHash` first (cheap), then by embedding cosine similarity
// (fuzzy near-duplicate), and inserts survivors into `question_bank`.
//
// This is the WORKER contract. The API-side `apps/api/src/modules/corpus`
// keeps its own adapter shape for the on-demand `POST /admin/corpus/sync/:id`
// path; the two pipelines write to the same table and use the same
// `promptHash` uniqueness invariant, so a row inserted by either side
// deduplicates against the other on re-run.

/** One normalized question, ready to persist to `question_bank`. */
export interface CorpusItem {
  /** Stable slug of the source adapter, e.g. `tech-interview-handbook`. */
  sourceId: string;
  /** URL the row came from — attribution + provenance. */
  sourceUrl: string;
  /** SPDX license id of the source content (MIT, CC0-1.0, CC-BY-4.0, ...). */
  license: string;
  /** Short label rendered as the question header. */
  title: string;
  /** Verbatim question text. This is what the grader / model sees. */
  body: string;
  /** Optional pre-extracted grading anchors. Empty → LLM extraction later. */
  keyPoints?: string[];
  /** sha256 of `body` truncated to 32 hex chars — matches `Question.promptHash`. */
  promptHash: string;
}

export interface CorpusAdapter {
  /** Stable identifier used in cron jobIds + registry lookups. */
  id: string;
  /** Human-readable name for logs. */
  name: string;
  /** SPDX license id of the source content. Only permissive licenses ship. */
  license: string;
  /** URL to the source repo / page (for attribution). */
  sourceUrl: string;
  /**
   * Fetch + parse the source, yielding one `CorpusItem` per question found.
   * Async generator so a huge source can stream without buffering the whole
   * thing in memory.
   */
  fetch(): AsyncGenerator<CorpusItem>;
}
