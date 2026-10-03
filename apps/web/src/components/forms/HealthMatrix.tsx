'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Database, HardDrive, RefreshCw, Sparkles, XCircle, Zap, type LucideIcon } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { ErrorBanner } from './AccountForm';

interface Check {
  ok: boolean;
  latencyMs: number;
  error?: string;
  detail?: string;
}
interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  checks: Record<string, Check>;
}

const ICONS: Record<string, LucideIcon> = {
  postgres: Database,
  redis: Zap,
  qdrant: HardDrive,
  ai: Sparkles,
};

const LABELS: Record<string, { name: string; blurb: string }> = {
  postgres: { name: 'Postgres', blurb: 'Structured data store' },
  redis: { name: 'Redis', blurb: 'Queues + cache' },
  qdrant: { name: 'Qdrant', blurb: 'Vector store' },
  ai: { name: 'AI provider', blurb: 'Chat + embeddings entry' },
};

const ORDER = ['postgres', 'redis', 'qdrant', 'ai'];

export function HealthMatrix() {
  const run = useCallback(() => apiPost<HealthResponse>('/setup/health/verify', {}), []);
  const { data: result, error: err, loading, refetch } = useApi(run);
  const running = loading;
  const allOk = result?.status === 'ok';

  return (
    <div className="flex flex-col gap-5">
      <div className="panel divide-y divide-[hsl(var(--border))]">
        {ORDER.map((key, i) => {
          const c = result?.checks[key];
          const meta = LABELS[key]!;
          const Icon = ICONS[key]!;
          const pending = loading && !c;
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] text-fg">{meta.name}</span>
                  <span className="text-[12.5px] text-fg-subtle">
                    {c?.detail ?? meta.blurb}
                  </span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium tabular-nums">
                {pending && (
                  <>
                    <ThinkingOrb state="searching" size={20} />
                    <span className="text-fg-subtle">Checking</span>
                  </>
                )}
                {c?.ok && (
                  <motion.span
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                    className="inline-flex items-center gap-1.5 text-[hsl(var(--success))]"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>{c.latencyMs}ms</span>
                  </motion.span>
                )}
                {c && !c.ok && (
                  <span className="inline-flex items-center gap-1.5 text-[hsl(var(--danger))]" title={c.error}>
                    <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>{(c.error ?? 'Failed').slice(0, 24)}</span>
                  </span>
                )}
              </span>
            </motion.div>
          );
        })}
      </div>

      {err && <ErrorBanner message={err} />}

      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => void refetch()} disabled={running}>
          <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Checking…' : 'Retry'}
        </Button>
        {allOk && (
          <Link href="/setup/13-recovery">
            <Button>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
