'use client';

import { useCallback, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Cpu,
  Cloud,
  Hash,
  KeyRound,
  RefreshCw,
  Server,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input, cn } from '@careeros/ui';
import { apiGet, apiPost } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';

type Mode = 'local' | 'external';

/**
 * Client-safe view returned by `GET /embeddings` (`EffectiveEmbeddingConfig`).
 * The API never returns the plaintext key — only whether one is stored
 * (`hasApiKey`), so the panel must never render or round-trip a stored secret.
 */
export interface EffectiveEmbeddingConfig {
  mode: Mode;
  model: string;
  externalBaseUrl?: string;
  dimensions?: number;
  hasApiKey: boolean;
}

/**
 * Write shape for `POST /embeddings` (`EmbeddingConfigInput`).
 * `externalApiKey` is present only when the user typed a new key; omitting it
 * tells the API to reuse the stored one. `dimensions` is required by the API for
 * `external` mode.
 */
export interface EmbeddingSavePayload {
  mode: Mode;
  model: string;
  externalBaseUrl?: string;
  externalApiKey?: string;
  dimensions?: number;
}

/**
 * Build the save payload from the loaded config plus the transient key input.
 * Only a newly typed key is sent — an empty input means "keep the stored key",
 * and the stored key is never part of `cfg` to begin with.
 */
export function buildEmbeddingPayload(
  cfg: EffectiveEmbeddingConfig,
  newApiKey: string,
): EmbeddingSavePayload {
  const payload: EmbeddingSavePayload = { mode: cfg.mode, model: cfg.model };
  if (cfg.mode !== 'external') return payload;
  if (cfg.externalBaseUrl) payload.externalBaseUrl = cfg.externalBaseUrl;
  if (newApiKey) payload.externalApiKey = newApiKey;
  if (cfg.dimensions !== undefined) payload.dimensions = cfg.dimensions;
  return payload;
}

interface TestResult {
  qdrantReachable: boolean;
  qdrantLatencyMs: number;
  upsertOk: boolean;
  searchOk: boolean;
  topScore: number;
  error?: string;
}

export function EmbeddingsPanel() {
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [reembedNote, setReembedNote] = useState<string | null>(null);
  const [reembedding, setReembedding] = useState(false);

  const refresh = useCallback(() => apiGet<EffectiveEmbeddingConfig>('/embeddings'), []);
  const {
    data: cfg,
    error,
    setData: setCfg,
    setError,
    refetch,
  } = useApi<EffectiveEmbeddingConfig>(refresh);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    setBusy(true);
    setError(null);
    setSavedNote(null);
    try {
      await apiPost('/embeddings', buildEmbeddingPayload(cfg, newApiKey));
      setNewApiKey('');
      setSavedNote('Saved. Run a re-embed to rebuild the vector store with the new mode.');
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await apiPost<TestResult>('/embeddings/test');
      setTestResult(r);
    } catch (e) {
      setTestResult({
        qdrantReachable: false,
        qdrantLatencyMs: 0,
        upsertOk: false,
        searchOk: false,
        topScore: 0,
        error: (e as Error).message,
      });
    } finally {
      setTesting(false);
    }
  }

  async function onReembed() {
    setReembedding(true);
    setReembedNote(null);
    try {
      const { enqueued } = await apiPost<{ enqueued: number }>('/embeddings/reembed');
      setReembedNote(
        enqueued === 0
          ? 'No embeddable content yet. Add resume facts first.'
          : `Enqueued ${enqueued} embedding jobs. Progress lands on System & workers.`,
      );
    } catch (e) {
      setReembedNote((e as Error).message);
    } finally {
      setReembedding(false);
    }
  }

  if (!cfg) return <Skeleton />;

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      <EmbeddingConfigForm
        cfg={cfg}
        newApiKey={newApiKey}
        savedNote={savedNote}
        busy={busy}
        onCfgChange={setCfg}
        onNewApiKeyChange={setNewApiKey}
        onSubmit={onSubmit}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
          Vector store round-trip
        </h2>
        <p className="text-[13px] leading-relaxed text-fg-muted">
          Embeds a sample string, upserts it to Qdrant, and searches it back. Confirms the pipeline end-to-end.
        </p>
        <div>
          <Button variant="ghost" onClick={onTest} disabled={testing}>
            {testing ? (
              <>
                <ThinkingOrb state="working" size={20} /> Testing
              </>
            ) : (
              'Run test'
            )}
          </Button>
        </div>
        {testResult && <TestBanner result={testResult} />}
      </section>

      <section className="flex flex-col gap-3 border-t border-[hsl(var(--border))] pt-8">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
          Re-embed corpus
        </h2>
        <p className="text-[13px] leading-relaxed text-fg-muted">
          Rebuild vectors for every resume fact. Use after switching embedding modes or models. Runs in the
          background via the embedding queue.
        </p>
        <div>
          <Button variant="ghost" onClick={onReembed} disabled={reembedding}>
            {reembedding ? (
              <>
                <ThinkingOrb state="working" size={20} /> Enqueuing
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" /> Re-embed all
              </>
            )}
          </Button>
        </div>
        {reembedNote && (
          <div className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-3.5 py-2.5 text-[13px] text-fg-muted">
            {reembedNote}
          </div>
        )}
      </section>
    </div>
  );
}

export interface EmbeddingConfigFormProps {
  cfg: EffectiveEmbeddingConfig;
  /** Transient input for a *new* key only. Never seeded from the stored secret. */
  newApiKey: string;
  savedNote: string | null;
  busy: boolean;
  onCfgChange: (next: EffectiveEmbeddingConfig) => void;
  onNewApiKeyChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

/**
 * Presentational form. Split out from `EmbeddingsPanel` so the contract
 * (`hasApiKey`, key reuse, `dimensions`) is assertable without jsdom.
 */
export function EmbeddingConfigForm({
  cfg,
  newApiKey,
  savedNote,
  busy,
  onCfgChange,
  onNewApiKeyChange,
  onSubmit,
}: EmbeddingConfigFormProps) {
  function onDimensionsChange(raw: string) {
    if (raw === '') {
      const next: EffectiveEmbeddingConfig = { ...cfg };
      delete next.dimensions;
      onCfgChange(next);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) onCfgChange({ ...cfg, dimensions: parsed });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-subtle">Mode</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <ModeCard
            id="local"
            current={cfg.mode}
            icon={Cpu}
            title="Local (bge-small-en)"
            body="Runs in-process, no data leaves the box. Recommended default."
            onSelect={() => onCfgChange({ ...cfg, mode: 'local', model: cfg.model || 'bge-small-en' })}
          />
          <ModeCard
            id="external"
            current={cfg.mode}
            icon={Cloud}
            title="External endpoint"
            body="OpenAI-compatible embeddings API. Slower start, better quality on some corpora."
            onSelect={() => onCfgChange({ ...cfg, mode: 'external' })}
          />
        </div>
      </section>

      <FormField icon={Cpu} label="Model">
        <Input
          data-testid="embeddings-model"
          value={cfg.model}
          onChange={(e) => onCfgChange({ ...cfg, model: e.target.value })}
          required
        />
      </FormField>

      {cfg.mode === 'external' && (
        <>
          <FormField icon={Server} label="Base URL" optional>
            <Input
              data-testid="embeddings-base-url"
              value={cfg.externalBaseUrl ?? ''}
              onChange={(e) => onCfgChange({ ...cfg, externalBaseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </FormField>

          <FormField
            icon={KeyRound}
            label="API key"
            hint={
              cfg.hasApiKey
                ? 'A key is stored. Leave blank to keep it, or type a new value to replace it.'
                : 'Encrypted at rest.'
            }
          >
            <Input
              data-testid="embeddings-api-key"
              type="password"
              value={newApiKey}
              onChange={(e) => onNewApiKeyChange(e.target.value)}
              placeholder={cfg.hasApiKey ? 'Leave blank to keep the stored key' : 'sk-…'}
              autoComplete="new-password"
            />
            {cfg.hasApiKey ? (
              <span
                data-testid="embeddings-key-stored"
                className="flex items-center gap-1.5 text-[11.5px] text-success"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Key stored
              </span>
            ) : (
              <span data-testid="embeddings-key-missing" className="text-[11.5px] text-fg-faint">
                No key stored yet
              </span>
            )}
          </FormField>

          <FormField
            icon={Hash}
            label="Dimensions"
            hint="Vector size the model returns (e.g. 1536 for text-embedding-3-small). Required so collections match."
          >
            <Input
              data-testid="embeddings-dimensions"
              type="number"
              min={1}
              max={8192}
              value={cfg.dimensions ?? ''}
              onChange={(e) => onDimensionsChange(e.target.value)}
              placeholder="1536"
              required
            />
          </FormField>
        </>
      )}

      {savedNote && (
        <div className="rounded-[var(--radius)] border border-success/30 bg-success/10 px-3.5 py-2.5 text-[13px] text-success">
          {savedNote}
        </div>
      )}

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Saving
            </>
          ) : (
            'Save embedding config'
          )}
        </Button>
      </div>
    </form>
  );
}

function ModeCard({
  id,
  current,
  icon: Icon,
  title,
  body,
  onSelect,
}: {
  id: Mode;
  current: Mode;
  icon: LucideIcon;
  title: string;
  body: string;
  onSelect: () => void;
}) {
  const active = id === current;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius)] border px-4 py-4 text-left transition-colors',
        active
          ? 'border-accent/40 bg-accent/5'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] hover:border-[hsl(var(--border-active))]',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', active ? 'text-accent' : 'text-fg-subtle')} />
        <span className="text-[14px] font-medium text-fg">{title}</span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-fg-muted">{body}</p>
    </button>
  );
}

function TestBanner({ result }: { result: TestResult }) {
  const allGood = result.qdrantReachable && result.upsertOk && result.searchOk;
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-[var(--radius)] border px-3.5 py-3 text-[13px]',
        allGood
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-danger/30 bg-danger/10 text-danger',
      )}
    >
      <div className="flex items-center gap-2">
        {allGood ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        <span className="font-medium">
          {allGood ? 'Round-trip OK' : result.error ?? 'Round-trip failed'}
        </span>
      </div>
      <div className="font-mono text-[11.5px] text-fg-muted">
        qdrant: {result.qdrantLatencyMs}ms · upsert: {String(result.upsertOk)} · search: {String(result.searchOk)} · top: {result.topScore.toFixed(3)}
      </div>
    </div>
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

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}
