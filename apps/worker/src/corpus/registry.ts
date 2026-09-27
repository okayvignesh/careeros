import type { CorpusAdapter } from './types';
import { techInterviewHandbookAdapter } from './adapters/tech-interview-handbook';
import { everyProgrammerShouldKnowAdapter } from './adapters/every-programmer-should-know';

/**
 * All worker-side corpus adapters. The refresh cron iterates this list every
 * Sunday 04:00 UTC (see `refresh.worker.ts`).
 *
 * The API-side adapter (`system-design-primer`) stays on-demand-only for now
 * because its README parser is happy with manual triggers and the operator
 * flow in Settings → Corpus already covers it. When we standardise on cron
 * for every source, promote it to `adapters` here and drop the API-side
 * on-demand shell.
 */
export const adapters: CorpusAdapter[] = [
  techInterviewHandbookAdapter,
  everyProgrammerShouldKnowAdapter,
];
