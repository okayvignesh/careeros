'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound, PlugZap, Server, Sparkles, XCircle, type LucideIcon } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';

type ProviderName = 'deepseek' | 'openai' | 'anthropic' | 'ollama' | 'azure' | 'openrouter' | 'custom';

interface ConfiguredProvider {
  id: string;
  provider: ProviderName;
  chatModel: string;
  reasoningModel: string | null;
  baseUrl: string | null;
  isDefault: boolean;
}

interface ProbeResult {
  ok: boolean;
  provider: string;
  chatModel: string;
  latencyMs: number;
  error?: string;
}

const PROVIDER_OPTIONS: Array<{ id: ProviderName; label: string; hint: string }> = [
  { id: 'deepseek', label: 'DeepSeek', hint: 'Recommended default' },
  { id: 'openai', label: 'OpenAI', hint: 'gpt-4o, gpt-4o-mini' },
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude Opus / Sonnet / Haiku' },
  { id: 'ollama', label: 'Ollama (local)', hint: 'Local endpoint on your machine' },
  { id: 'azure', label: 'Azure OpenAI', hint: 'Requires deployment base URL' },
  { id: 'openrouter', label: 'OpenRouter', hint: 'Aggregator across many models' },
  { id: 'custom', label: 'Custom (OpenAI-compat)', hint: 'Any OpenAI-schema endpoint' },
];

export function ProvidersPanel() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);

  const refresh = useCallback(() => apiGet<ConfiguredProvider[]>('/providers'), []);
  const { data: rows, error, setError, refetch } = useApi<ConfiguredProvider[]>(refresh);

  async function onSetDefault(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiPost(`/providers/${id}/default`);
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function onProbe() {
    setProbing(true);
    setProbe(null);
    try {
      const r = await apiPost<ProbeResult>('/providers/probe');
      setProbe(r);
    } catch (e) {
      setProbe({ ok: false, provider: '', chatModel: '', latencyMs: 0, error: (e as Error).message });
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
            Configured providers
          </h2>
          <Button variant="ghost" size="sm" onClick={onProbe} disabled={probing || !rows?.length}>
            {probing ? (
              <>
                <ThinkingOrb state="working" size={20} /> Testing
              </>
            ) : (
              <>
                <PlugZap className="h-4 w-4" /> Test active
              </>
            )}
          </Button>
        </div>

        {rows === null ? (
          <SkeletonList />
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <ProviderRow
                key={r.id}
                row={r}
                busy={busyId === r.id}
                onSetDefault={() => onSetDefault(r.id)}
              />
            ))}
          </div>
        )}

        {probe && <ProbeResultRow result={probe} />}
      </section>

      <AddProviderForm onSaved={refetch} />
    </div>
  );
}

function ProviderRow({
  row,
  busy,
  onSetDefault,
}: {
  row: ConfiguredProvider;
  busy: boolean;
  onSetDefault: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-[var(--radius)] border px-4 py-3',
        row.isDefault
          ? 'border-accent/40 bg-accent/5'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))]',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 text-[14px] font-medium text-fg">
          {providerLabel(row.provider)}
          {row.isDefault && (
            <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-[1px] text-[10.5px] font-medium uppercase tracking-wider text-accent">
              Active
            </span>
          )}
        </div>
        <div className="font-mono text-[12px] text-fg-muted">
          {row.chatModel}
          {row.baseUrl && <span className="text-fg-faint"> · {row.baseUrl}</span>}
        </div>
      </div>
      {!row.isDefault && (
        <Button variant="ghost" size="sm" onClick={onSetDefault} disabled={busy}>
          {busy ? <ThinkingOrb state="working" size={20} /> : 'Set as active'}
        </Button>
      )}
    </div>
  );
}

function ProbeResultRow({ result }: { result: ProbeResult }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius)] border px-3.5 py-2.5 text-[13px]',
        result.ok
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-danger/30 bg-danger/10 text-danger',
      )}
    >
      {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      {result.ok ? (
        <span>
          Connected to {result.provider} · {result.chatModel} · <span className="font-mono">{result.latencyMs}ms</span>
        </span>
      ) : (
        <span>{result.error ?? 'Probe failed'}</span>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-8 text-center text-[13px] text-fg-subtle">
      No providers configured yet. Add one below to enable LLM calls.
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}

function AddProviderForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [provider, setProvider] = useState<ProviderName>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [chatModel, setChatModel] = useState('deepseek-chat');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      await apiPost('/providers', {
        provider,
        apiKey,
        chatModel,
        ...(baseUrl ? { baseUrl } : {}),
      });
      setApiKey('');
      setOk(true);
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
        Add or update a provider
      </h2>
      <p className="text-[13px] leading-relaxed text-fg-muted">
        Saving becomes the active provider. Keys are encrypted at rest with AES-GCM.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormField icon={Sparkles} label="Provider">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderName)}
            className="h-11 w-full rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3.5 text-[13.5px]"
          >
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} · {o.hint}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          icon={KeyRound}
          label="API key"
          hint="Encrypted at rest. Not shown again after saving."
        >
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            required
          />
        </FormField>

        <FormField icon={Sparkles} label="Chat model">
          <Input value={chatModel} onChange={(e) => setChatModel(e.target.value)} required />
        </FormField>

        <FormField icon={Server} label="Base URL" optional>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
        </FormField>

        {err && (
          <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            {err}
          </div>
        )}
        {ok && (
          <div className="rounded-[var(--radius)] border border-success/30 bg-success/10 px-3.5 py-2.5 text-[13px] text-success">
            Saved. Now the active provider.
          </div>
        )}

        <div>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <>
                <ThinkingOrb state="working" size={20} /> Saving
              </>
            ) : (
              'Save provider'
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}

function FormField({
  icon: Icon,
  label,
  hint,
  optional,
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-subtle">
        <Icon className="h-3.5 w-3.5" />
        {label}
        {optional && <span className="text-[11px] text-fg-faint">(optional)</span>}
      </span>
      {children}
      {hint && <span className="text-[11.5px] leading-relaxed text-fg-faint">{hint}</span>}
    </label>
  );
}

function providerLabel(id: ProviderName): string {
  return PROVIDER_OPTIONS.find((o) => o.id === id)?.label ?? id;
}
