'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Database,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { ErrorBanner } from './AccountForm';

interface TestResult {
  qdrantReachable: boolean;
  qdrantLatencyMs: number;
  upsertOk: boolean;
  searchOk: boolean;
  topScore: number;
  error?: string;
}

const CHECKS = [
  { key: 'qdrantReachable', icon: Database, name: 'Vector store reachable', blurb: 'Qdrant health probe' },
  { key: 'upsertOk', icon: Sparkles, name: 'Vector upsert', blurb: 'Round-trip a sample point' },
  { key: 'searchOk', icon: Sparkles, name: 'Vector search', blurb: 'Retrieve nearest neighbour' },
] as const;

export function EmbeddingTest() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<TestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setState('running');
    setErr(null);
    try {
      const r = await apiPost<TestResult>('/setup/embedding/test', {});
      setResult(r);
      setState(r.qdrantReachable && r.upsertOk && r.searchOk ? 'done' : 'error');
    } catch (e) {
      setErr((e as Error).message);
      setState('error');
    }
  }

  useEffect(() => {
    void run();
  }, []);

  const allOk = state === 'done';

  return (
    <div className="flex flex-col gap-5">
      <div className="panel divide-y divide-[hsl(var(--border))]">
        {CHECKS.map(({ key, icon: Icon, name, blurb }, i) => {
          const value = result?.[key];
          const pending = state === 'running' && value === undefined;
          const ok = value === true;
          const failed = value === false;
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] text-fg">{name}</span>
                  <span className="text-[12.5px] text-fg-subtle">{blurb}</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium tabular-nums">
                {pending && (
                  <>
                    <ThinkingOrb state="working" size={20} />
                    <span className="text-fg-subtle">Running</span>
                  </>
                )}
                {ok && (
                  <motion.span
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                    className="inline-flex items-center gap-1.5 text-[hsl(var(--success))]"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                    {key === 'qdrantReachable' && <span>{result!.qdrantLatencyMs}ms</span>}
                    {key === 'searchOk' && <span>score {result!.topScore.toFixed(2)}</span>}
                    {key === 'upsertOk' && <span>OK</span>}
                  </motion.span>
                )}
                {failed && (
                  <span className="inline-flex items-center gap-1.5 text-[hsl(var(--danger))]">
                    <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>Failed</span>
                  </span>
                )}
                {!pending && value === undefined && (
                  <>
                    <Circle className="h-3.5 w-3.5 text-fg-faint" />
                    <span className="text-fg-faint">Pending</span>
                  </>
                )}
              </span>
            </motion.div>
          );
        })}
      </div>

      {(err || result?.error) && <ErrorBanner message={err ?? result!.error!} />}

      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={run} disabled={state === 'running'}>
          <RefreshCw className={`h-4 w-4 ${state === 'running' ? 'animate-spin' : ''}`} />
          {state === 'running' ? 'Testing…' : 'Retry'}
        </Button>
        {allOk && (
          <Link href="/setup/07-github">
            <Button>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
