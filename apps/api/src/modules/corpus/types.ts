/**
 * Adapter interface for external question corpus sources.
 *
 * Every adapter fetches from a permissive-licensed source (declared in
 * `licenseSpdx`), parses the source-specific format, and emits normalized
 * `IngestedQuestion` records. The `CorpusService.sync` shell handles the
 * generic ingestion pipeline: LLM key-points extraction, dedupe via
 * `promptHash`, and attribution persistence.
 *
 * ponytail: single hand-rolled parser per adapter for the walking-skeleton.
 * When more than 3 markdown-shaped adapters exist, extract a shared markdown
 * question-list parser at that point.
 */

export interface IngestedQuestion {
  /** Verbatim question text as parsed from the source. */
  prompt: string;
  /** Rough skill mapping — adapter's best guess; can be refined per row. */
  skillIds: string[];
  /** Difficulty is the adapter's judgement or the source's own tag. */
  difficulty: 'easy' | 'medium' | 'hard';
  /** Optional inline answer hint from the source. */
  answerHint?: string | null;
}

export interface CorpusAdapter {
  /** Stable identifier used by the admin endpoint (`POST /admin/corpus/sync/:id`). */
  id: string;
  /** Human-readable name shown to operators. */
  name: string;
  /** SPDX license ID of the source content. Only permissive licenses ship. */
  licenseSpdx: string;
  /** Where the raw content lives (attribution + provenance). */
  sourceUrl: string;
  /** Credit line rendered under each question in the runner. */
  attribution: string;
  /** Fetch + parse; returns [] if the source layout changed and nothing matched. */
  fetch(): Promise<IngestedQuestion[]>;
}
