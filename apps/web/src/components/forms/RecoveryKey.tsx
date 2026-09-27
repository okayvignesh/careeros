'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, Check, Copy, Download, RotateCw, ShieldCheck } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button, cn } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { ErrorBanner } from './AccountForm';

export function RecoveryKey() {
  const router = useRouter();
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    setCopied(false);
    setDownloaded(false);
    setAck(false);
    try {
      const r = await apiPost<{ key: string; last4: string }>('/recovery/generate', {});
      setKey(r.key);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void generate();
  }, []);

  function copy() {
    if (!key) return;
    void navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    if (!key) return;
    const blob = new Blob(
      [`Career OS Recovery Key\nGenerated: ${new Date().toISOString()}\n\n${key}\n\nKeep this file somewhere safe. Losing it means encrypted secrets cannot be recovered on master-key rotation.`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `careeros-recovery-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }

  async function acknowledgeAndContinue() {
    setBusy(true);
    setErr(null);
    try {
      await apiPost('/setup/recovery/acknowledge', {});
      router.push('/setup/14-complete');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="panel flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2 text-fg-muted">
          <ShieldCheck className="h-4 w-4" strokeWidth={1.7} />
          <span className="text-[13px] font-medium">Recovery key</span>
        </div>

        <div className="relative overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg))] px-4 py-5 font-mono text-[15px] tracking-[0.02em] text-fg">
          {key ? (
            <motion.span
              key={key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="break-all"
            >
              {key}
            </motion.span>
          ) : (
            <span className="inline-flex items-center gap-2 text-fg-subtle">
              <ThinkingOrb state="composing" size={20} /> Generating…
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={copy} disabled={!key}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="sm" variant="secondary" onClick={download} disabled={!key}>
            <Download className="h-3.5 w-3.5" />
            Download .txt
          </Button>
          <Button size="sm" variant="ghost" onClick={generate} disabled={busy}>
            <RotateCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
            Regenerate
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-[var(--radius)] border border-[hsl(var(--warn)/0.3)] bg-[hsl(var(--warn)/0.06)] px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warn))]" strokeWidth={1.8} />
        <div className="flex flex-col gap-1 text-[12.5px] leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">Save this somewhere safe.</span>
          <span>
            Losing your recovery key + master <code className="font-mono">ENCRYPTION_KEY</code>{' '}
            means encrypted provider credentials and OAuth tokens become unrecoverable. Password
            managers, encrypted note apps, or a printed copy in a safe are all fine.
          </span>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="h-4 w-4 rounded border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] text-[hsl(var(--accent))]"
        />
        <span className="text-[13px] text-fg">
          I&apos;ve saved my recovery key somewhere safe.
        </span>
      </label>

      {err && <ErrorBanner message={err} />}

      <div className="flex items-center gap-3">
        <Button
          size="lg"
          onClick={acknowledgeAndContinue}
          disabled={!ack || !downloaded || busy}
        >
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Confirming…
            </>
          ) : (
            <>
              Confirm and continue <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
        {!downloaded && (
          <span className="text-[12px] text-fg-subtle">Download the key first.</span>
        )}
      </div>
    </div>
  );
}
