export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  factor?: number;
  maxMs?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

const defaultShouldRetry = (err: unknown): boolean => {
  const status = (err as { status?: number; response?: { status?: number } })?.status
    ?? (err as { response?: { status?: number } })?.response?.status;
  if (status == null) return true; // network / dns / unknown → retry
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
};

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 500;
  const factor = opts.factor ?? 2;
  const maxMs = opts.maxMs ?? 30_000;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !shouldRetry(err, attempt)) throw err;
      const delay = jitter(Math.min(baseMs * factor ** (attempt - 1), maxMs));
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

const jitter = (ms: number): number => Math.floor(Math.random() * ms);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
