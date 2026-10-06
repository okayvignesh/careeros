'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardCopy, Download, FileText, RefreshCw, ShieldQuestion } from 'lucide-react';
import { Button } from '@careeros/ui';
import { apiBrowserUrl, apiGet, apiPost } from '@/lib/api-client';

interface Bullet {
  text: string;
  factRefs: string[];
}
interface Section {
  heading: string;
  bullets: Bullet[];
}
interface Content {
  summary: string;
  sections: Section[];
}
interface FactRefInfo {
  id: string;
  kind: string;
  summary: string;
}
interface DroppedBullet {
  section: string;
  text: string;
  reason: string;
}
interface FactCheckAudit {
  status: 'passed' | 'partial' | 'unchecked';
  bulletsChecked: number;
  bulletsPassed: number;
  bulletsDropped: number;
  dropped: DroppedBullet[];
}
interface Variant {
  id: string;
  jobId: string | null;
  jobTitle: string | null;
  jobCompany: string | null;
  roleTarget: string;
  templateId: string;
  region: string | null;
  contact: { name?: string; email?: string; location?: string; headline?: string } | null;
  content: Content;
  factRefs: FactRefInfo[];
  audit: FactCheckAudit;
  createdAt: string;
}

const TEMPLATE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'classic', label: 'Classic (ATS baseline)' },
  { id: 'dense-tech', label: 'Dense Tech' },
  { id: 'modern-minimal', label: 'Modern Minimal' },
  { id: 'international', label: 'International (A4)' },
];

function canonicalTemplateId(raw: string): string {
  const aliases: Record<string, string> = { 'ats-first': 'classic', standard: 'classic', default: 'classic' };
  return aliases[raw] ?? raw;
}

export function ResumeVariantView({ id }: { id: string }) {
  const [v, setV] = useState<Variant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiGet<Variant>(`/me/resume-variants/${encodeURIComponent(id)}`)
      .then(setV)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  async function copyMarkdown() {
    if (!v) return;
    const md = toMarkdown(v);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard write failed. Copy manually from below.');
    }
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!v) return <Skeleton />;

  const factById = new Map(v.factRefs.map((f) => [f.id, f]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-3 text-[13px]">
        <FileText className="h-4 w-4 text-fg-subtle" />
        <div className="flex flex-col">
          <span className="text-fg">
            Tailored for <span className="font-medium">{v.jobTitle ?? v.roleTarget}</span>
            {v.jobCompany && <span className="text-fg-muted"> @ {v.jobCompany}</span>}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-faint">
            <span data-testid="resume-region">Region {v.region ?? 'unspecified'}</span>
            <span aria-hidden>·</span>
            <span data-testid="resume-template">Template {canonicalTemplateId(v.templateId)}</span>
            <span aria-hidden>·</span>
            <span>Generated {new Date(v.createdAt).toLocaleString()}</span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {v.jobId && (
            <Link href={`/jobs`} className="text-[12px] text-fg-muted hover:text-fg">
              Back to jobs
            </Link>
          )}
          <a
            href={apiBrowserUrl(`/me/resume-variants/${encodeURIComponent(v.id)}/pdf`)}
            className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-2 py-1 text-[12px] text-fg hover:border-accent/40 hover:text-accent"
          >
            <Download className="h-3.5 w-3.5" /> Download PDF
          </a>
          <Button size="sm" variant="ghost" onClick={copyMarkdown}>
            <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy markdown'}
          </Button>
        </div>
      </div>

      <AuditPanel audit={v.audit} />

      {v.jobId && <RegenerateControls variant={v} onError={setError} />}

      <section className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-5">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">Summary</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-fg">{v.content.summary}</p>
      </section>

      {v.content.sections.map((sec, i) => (
        <section key={i} className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-6 py-5">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
            {sec.heading}
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {sec.bullets.map((b, j) => (
              <li key={j} className="flex flex-col gap-1">
                <div className="flex gap-2 text-[13.5px] text-fg">
                  <span className="text-fg-faint">·</span>
                  <span>{b.text}</span>
                </div>
                {b.factRefs.length > 0 && (
                  <div className="ml-4 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="text-fg-faint">from</span>
                    {b.factRefs.map((refId) => {
                      const fact = factById.get(refId);
                      return (
                        <Link
                          key={refId}
                          href="/facts"
                          title={fact?.summary ?? refId}
                          className="inline-flex items-center gap-0.5 rounded border border-[hsl(var(--border))] px-1.5 py-[1px] font-mono text-fg-subtle hover:border-accent/40 hover:text-accent"
                        >
                          {fact?.kind ?? 'fact'}
                          <ArrowUpRight className="h-2.5 w-2.5" />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * P2b: real control over the region-template. The resolved default comes from
 * the API (region → template, code-selected); this lets the user override it
 * and regenerate through the real endpoint.
 */
function RegenerateControls({ variant, onError }: { variant: Variant; onError: (e: string) => void }) {
  const router = useRouter();
  const [template, setTemplate] = useState(canonicalTemplateId(variant.templateId));
  const [busy, setBusy] = useState(false);

  async function regenerate() {
    if (!variant.jobId) return;
    setBusy(true);
    onError('');
    try {
      const next = await apiPost<{ id: string }>(
        `/me/resume-variants/for-job/${encodeURIComponent(variant.jobId)}?template=${encodeURIComponent(template)}`,
      );
      router.push(`/resume-variants/${next.id}`);
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-4 py-2.5 text-[12.5px]">
      <label htmlFor="resume-template-select" className="text-fg-muted">
        Template
      </label>
      <select
        id="resume-template-select"
        data-testid="resume-template-select"
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        disabled={busy}
        className="rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg))] px-2 py-1 text-[12.5px] text-fg"
      >
        {TEMPLATE_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
      <Button size="sm" variant="ghost" onClick={regenerate} disabled={busy} data-testid="resume-regenerate">
        <RefreshCw className="h-3.5 w-3.5" /> {busy ? 'Regenerating' : 'Regenerate'}
      </Button>
    </div>
  );
}

function AuditPanel({ audit }: { audit: FactCheckAudit }) {
  const tone =
    audit.status === 'passed'
      ? 'border-success/30 bg-success/5 text-success'
      : audit.status === 'partial'
        ? 'border-warning/30 bg-warning/10 text-warning'
        : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] text-fg-muted';
  const Icon = audit.status === 'passed' ? CheckCircle2 : audit.status === 'partial' ? AlertTriangle : ShieldQuestion;
  const headline =
    audit.status === 'passed'
      ? `Fact-check passed: all ${audit.bulletsChecked} bullets supported by cited facts.`
      : audit.status === 'partial'
        ? `Fact-check partial: ${audit.bulletsPassed} of ${audit.bulletsChecked} bullets kept, ${audit.bulletsDropped} dropped.`
        : 'This variant was not fact-checked (older generation or check failed). Verify claims manually before sending.';
  return (
    <details
      className={`rounded-[var(--radius)] border px-4 py-3 ${tone}`}
      open={audit.status === 'partial'}
    >
      <summary className="flex cursor-pointer items-center gap-2 text-[12.5px]">
        <Icon className="h-4 w-4" />
        <span>{headline}</span>
      </summary>
      {audit.dropped.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 text-[12px] text-fg">
          {audit.dropped.map((d, i) => (
            <li key={i} className="flex flex-col gap-0.5 rounded border border-warning/20 bg-[hsl(var(--bg-elev-1))] px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
                Dropped from {d.section}
              </span>
              <span className="italic text-fg-muted">&ldquo;{d.text}&rdquo;</span>
              <span className="text-fg-faint">Reason: {d.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function toMarkdown(v: Variant): string {
  const lines: string[] = [];
  lines.push(`# ${v.roleTarget}${v.jobCompany ? ` @ ${v.jobCompany}` : ''}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(v.content.summary);
  for (const sec of v.content.sections) {
    lines.push('');
    lines.push(`## ${sec.heading}`);
    for (const b of sec.bullets) lines.push(`- ${b.text}`);
  }
  return lines.join('\n');
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}
