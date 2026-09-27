'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardCopy, Download, Mail, ShieldQuestion } from 'lucide-react';
import { Button } from '@careeros/ui';
import { apiBrowserUrl, apiGet } from '@/lib/api-client';

interface Paragraph {
  text: string;
  factRefs: string[];
}
interface Content {
  greeting: string;
  paragraphs: Paragraph[];
  closing: string;
}
interface FactRefInfo {
  id: string;
  kind: string;
  summary: string;
}
interface DroppedParagraph {
  index: number;
  text: string;
  reason: string;
}
interface FactCheckAudit {
  status: 'passed' | 'partial' | 'unchecked';
  paragraphsChecked: number;
  paragraphsPassed: number;
  paragraphsDropped: number;
  dropped: DroppedParagraph[];
}
interface Letter {
  id: string;
  jobId: string | null;
  jobTitle: string | null;
  jobCompany: string | null;
  roleTarget: string;
  templateId: string;
  content: Content;
  factRefs: FactRefInfo[];
  audit: FactCheckAudit;
  createdAt: string;
}

export function CoverLetterView({ id }: { id: string }) {
  const [letter, setLetter] = useState<Letter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiGet<Letter>(`/me/cover-letters/${encodeURIComponent(id)}`)
      .then(setLetter)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  async function copyPlain() {
    if (!letter) return;
    const body = toPlainText(letter);
    try {
      await navigator.clipboard.writeText(body);
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
  if (!letter) return <Skeleton />;

  const factById = new Map(letter.factRefs.map((f) => [f.id, f]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-3 text-[13px]">
        <Mail className="h-4 w-4 text-fg-subtle" />
        <div className="flex flex-col">
          <span className="text-fg">
            For <span className="font-medium">{letter.jobTitle ?? letter.roleTarget}</span>
            {letter.jobCompany && <span className="text-fg-muted"> @ {letter.jobCompany}</span>}
          </span>
          <span className="text-[11.5px] text-fg-faint">
            Template {letter.templateId} · Generated {new Date(letter.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/jobs" className="text-[12px] text-fg-muted hover:text-fg">
            Back to jobs
          </Link>
          <a
            href={apiBrowserUrl(`/me/cover-letters/${encodeURIComponent(letter.id)}/pdf`)}
            className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-2 py-1 text-[12px] text-fg hover:border-accent/40 hover:text-accent"
          >
            <Download className="h-3.5 w-3.5" /> Download PDF
          </a>
          <Button size="sm" variant="ghost" onClick={copyPlain}>
            <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy plain text'}
          </Button>
        </div>
      </div>

      <AuditPanel audit={letter.audit} />

      <article className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-8 py-8 text-[14px] leading-relaxed text-fg">
        <p>{letter.content.greeting}</p>
        {letter.content.paragraphs.map((p, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <p className="whitespace-pre-line">{p.text}</p>
            {p.factRefs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-[10.5px]">
                <span className="text-fg-faint">from</span>
                {p.factRefs.map((refId) => {
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
          </div>
        ))}
        <p>{letter.content.closing}</p>
      </article>
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
      ? `Fact-check passed: all ${audit.paragraphsChecked} paragraphs supported by cited facts.`
      : audit.status === 'partial'
        ? `Fact-check partial: ${audit.paragraphsPassed} of ${audit.paragraphsChecked} paragraphs kept, ${audit.paragraphsDropped} dropped.`
        : 'This letter was not fact-checked (check failed). Verify claims manually before sending.';
  return (
    <details className={`rounded-[var(--radius)] border px-4 py-3 ${tone}`} open={audit.status === 'partial'}>
      <summary className="flex cursor-pointer items-center gap-2 text-[12.5px]">
        <Icon className="h-4 w-4" />
        <span>{headline}</span>
      </summary>
      {audit.dropped.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 text-[12px] text-fg">
          {audit.dropped.map((d, i) => (
            <li key={i} className="flex flex-col gap-0.5 rounded border border-warning/20 bg-[hsl(var(--bg-elev-1))] px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
                Dropped paragraph #{d.index + 1}
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

function toPlainText(letter: Letter): string {
  const parts = [letter.content.greeting, '', ...letter.content.paragraphs.map((p) => p.text), '', letter.content.closing];
  return parts.join('\n\n');
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}
