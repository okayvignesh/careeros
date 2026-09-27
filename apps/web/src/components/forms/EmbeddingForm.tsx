'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Cpu, Cloud } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { ErrorBanner } from './AccountForm';
import { cn } from '@careeros/ui';

const options = [
  {
    id: 'local' as const,
    icon: Cpu,
    title: 'Local',
    body: 'Runs on this host. Zero external calls. Recommended for privacy.',
    hint: 'bge-small-en · 384 dim',
  },
  {
    id: 'external' as const,
    icon: Cloud,
    title: 'External',
    body: 'Provider-hosted embeddings via an OpenAI-compatible endpoint.',
    hint: 'Requires additional API key',
  },
];

export function EmbeddingForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'local' | 'external'>('local');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiPost('/setup/embedding', { mode, model: 'bge-small-en' });
      router.push('/setup/06-embedding-test');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {options.map(({ id, icon: Icon, title, body, hint }) => {
          const selected = mode === id;
          return (
            <motion.button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 24 }}
              className={cn(
                'flex flex-col items-start gap-2.5 rounded-[var(--radius-lg)] border p-5 text-left transition-all duration-200',
                selected
                  ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.06)]'
                  : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] hover:border-[hsl(var(--border-active))]',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 transition-colors',
                  selected ? 'text-[hsl(var(--accent))]' : 'text-fg-subtle',
                )}
                strokeWidth={1.8}
              />
              <span className="text-[14px] font-medium text-fg">{title}</span>
              <span className="text-[12.5px] leading-relaxed text-fg-muted">{body}</span>
              <span className="text-[11.5px] text-fg-faint">{hint}</span>
            </motion.button>
          );
        })}
      </div>

      {err && <ErrorBanner message={err} />}

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Saving…
            </>
          ) : (
            <>
              Save and continue <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
