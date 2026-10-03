'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, RefreshCw, XCircle, Circle } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { ErrorBanner } from './AccountForm';

interface Capability {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

interface ProbeResult {
  chat: Capability;
  structured: Capability;
  tools: Capability;
  streaming: Capability;
}

const LABELS: Array<{ key: keyof ProbeResult; name: string; blurb: string }> = [
  { key: 'chat', name: 'Chat', blurb: 'Basic completion' },
  { key: 'structured', name: 'Structured output', blurb: 'JSON schema compliance' },
  { key: 'tools', name: 'Function tools', blurb: 'Tool-call emission' },
  { key: 'streaming', name: 'Streaming', blurb: 'Server-sent events' },
];

export function CapabilityProbe() {
  const run = useCallback(() => apiPost<ProbeResult>('/setup/provider/probe', {}), []);
  const { data: result, error: err, loading, refetch } = useApi(run);
  const running = loading;
  const allOk = !!result && Object.values(result).every((c) => c.ok);

  return (
    <div className="flex flex-col gap-5">
      <div className="panel divide-y divide-[hsl(var(--border))]">
        {LABELS.map(({ key, name, blurb }, i) => {
          const c = result?.[key];
          const pending = loading && !c;
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] text-fg">{name}</span>
                <span className="text-[12.5px] text-fg-subtle">{blurb}</span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium tabular-nums">
                {pending && (
                  <>
                    <ThinkingOrb state="working" size={20} />
                    <span className="text-fg-subtle">Running</span>
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
                {!c && !pending && (
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

      {err && <ErrorBanner message={err} />}

      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => void refetch()} disabled={running}>
          <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Testing…' : 'Retry probe'}
        </Button>
        {allOk && (
          <Link href="/setup/05-embedding">
            <Button>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
