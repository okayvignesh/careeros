'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';

export default function Complete() {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiPost('/setup/complete', {})
      .then(() => setDone(true))
      .catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-10 px-8 py-12">
      <Link
        href="/setup/13-recovery"
        className="group inline-flex w-fit items-center gap-1.5 text-[12.5px] text-fg-muted transition-colors duration-200 hover:text-fg"
      >
        <ArrowLeft
          className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
          strokeWidth={1.8}
        />
        Back to Recovery key
      </Link>

      <div className="flex flex-col gap-6">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        >
          {done ? (
            <CheckCircle2 className="h-10 w-10 text-[hsl(var(--success))]" strokeWidth={1.5} />
          ) : (
            <ThinkingOrb state="working" size={64} />
          )}
        </motion.div>
        <h1 className="text-[42px] font-semibold leading-tight tracking-[-0.025em]">
          {done ? "You're all set." : 'Finalising setup…'}
        </h1>
        <p className="max-w-lg text-[15px] leading-relaxed text-fg-muted">
          {done
            ? 'Your Career OS instance is ready. Head to the dashboard to watch your evidence graph fill in as you connect data.'
            : 'Just a moment while we mark setup complete.'}
        </p>
        {err && (
          <p className="rounded-[var(--radius)] border border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.06)] px-3.5 py-2.5 text-[13px] text-[hsl(var(--danger))]">
            {err}
          </p>
        )}
      </div>

      {done && (
        <div>
          <Link href="/dashboard">
            <Button size="lg">
              Enter dashboard <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
