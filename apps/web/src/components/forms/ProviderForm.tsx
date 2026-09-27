'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound, Server, Sparkles } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { ErrorBanner, Field } from './AccountForm';

export function ProviderForm() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [chatModel, setChatModel] = useState('deepseek-flash');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiPost('/setup/provider', {
        provider: 'deepseek',
        apiKey,
        chatModel,
        baseUrl: baseUrl || undefined,
      });
      router.push('/setup/04-capability');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Field icon={Sparkles} label="Provider">
        <div className="flex h-11 items-center justify-between rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3.5 text-[13.5px]">
          <span>DeepSeek</span>
          <span className="text-[12px] text-fg-faint">Default</span>
        </div>
      </Field>

      <Field
        icon={KeyRound}
        label="API key"
        hint="Encrypted at rest with AES-GCM. Never rendered to the browser again after this step."
      >
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          required
        />
      </Field>

      <Field icon={Sparkles} label="Chat model">
        <Input value={chatModel} onChange={(e) => setChatModel(e.target.value)} required />
      </Field>

      <Field icon={Server} label="Base URL" optional>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.deepseek.com/v1"
        />
      </Field>

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
