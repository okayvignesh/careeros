// Qdrant collection registry. One collection per content class (not one big collection),
// each carrying its own payload shape. Every point payload MUST include `user_id` and
// `sensitivity` so search-time filters can enforce access control.

export interface CollectionDef {
  /** Qdrant collection name. Stable slug, safe as a URL segment. */
  name: string;
  /** Vector dimension. Every point in this collection has this many components. */
  dim: number;
  /** Similarity metric. */
  distance: 'Cosine' | 'Dot' | 'Euclid';
  /** Human-readable description. Not sent to Qdrant, kept for docs. */
  purpose: string;
}

export const COLLECTION_CAREER_FACTS: CollectionDef = {
  name: 'career_facts',
  dim: 384,
  distance: 'Cosine',
  purpose: 'Resume + fact base chunks. Payload: {user_id, sensitivity, source_id, kind, chunk_idx, hash}',
};

export const COLLECTION_CODE_CHUNKS: CollectionDef = {
  name: 'code_chunks',
  dim: 384,
  distance: 'Cosine',
  purpose: 'Repository source chunks. Payload: {user_id, sensitivity, repo_id, path, chunk_idx, hash}',
};

export const COLLECTION_PROJECT_DOCS: CollectionDef = {
  name: 'project_docs',
  dim: 384,
  distance: 'Cosine',
  purpose: 'READMEs and repo docs. Payload: {user_id, sensitivity, repo_id, path, chunk_idx, hash}',
};

export const ALL_COLLECTIONS: readonly CollectionDef[] = [
  COLLECTION_CAREER_FACTS,
  COLLECTION_CODE_CHUNKS,
  COLLECTION_PROJECT_DOCS,
] as const;

/**
 * Every collection pinned to one effective dimension. The registry above keeps
 * `dim: 384` as the local/default value for docs + tests; at runtime the
 * embedding provider's dimension (`external` can be any size) is the source of
 * truth, so callers that create Qdrant collections must pass the resolved dim
 * through here instead of reading `ALL_COLLECTIONS[i].dim`.
 */
export function collectionsForDim(dim: number): CollectionDef[] {
  return ALL_COLLECTIONS.map((c) => ({ ...c, dim }));
}

/** Payload keys every point in every collection must carry. */
export interface BasePointPayload {
  user_id: string;
  sensitivity: 'public' | 'personal' | 'confidential' | 'employer-confidential';
  source_id: string;
  chunk_idx: number;
  hash: string;
  /** Last-seen wall-clock timestamp. Overwritten on every re-embed of the same point ID. */
  timestamp: string;
}
