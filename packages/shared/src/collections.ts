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
