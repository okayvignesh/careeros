// Shared queue definitions so api (producer) and worker (consumer) agree on names + payloads.
// Add new job types here; every producer/consumer imports from this module only.

export const QUEUE_GITHUB = 'github';

export type GithubJobName = 'sync';

export interface GithubSyncPayload {
  userId: string;
  reason: 'setup' | 'manual' | 'scheduled';
}

export const QUEUE_GITLAB = 'gitlab';

export type GitlabJobName = 'sync';

export interface GitlabSyncPayload {
  userId: string;
  reason: 'setup' | 'manual' | 'scheduled';
}

export const QUEUE_EMBEDDING = 'embedding';

export type EmbeddingJobName = 'generate';

/**
 * Embedding job. One job per source-item; the worker chunks internally.
 * `collection` matches a CollectionDef.name from collections.ts.
 * `sourceKind` scopes payload shape (e.g. 'resume_fact' → payload includes fact.kind).
 * `sensitivity` is set by the enqueue site so the gate is honoured at write time.
 */
export interface EmbeddingGeneratePayload {
  userId: string;
  collection: string;
  sourceId: string;
  sourceKind: 'resume_fact' | 'code_file' | 'repo_doc' | 'other';
  text: string;
  sensitivity: 'public' | 'personal' | 'confidential' | 'employer-confidential';
  meta?: Record<string, string | number | boolean>;
}
