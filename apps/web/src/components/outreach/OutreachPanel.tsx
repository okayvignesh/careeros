'use client';

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Mail, Send, ShieldCheck, Trash2, Wand2 } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input, cn } from '@careeros/ui';
import { INDUSTRY_VARIANTS, OUTREACH_TEMPLATES, OUTREACH_TEMPLATE_IDS } from '@careeros/shared';
import { Loader } from '@/components/Loader';
import { UnavailableNotice } from '@/components/UnavailableNotice';
import { useApi } from '@/lib/use-api';
import {
  type OutreachMessage,
  composeOutreach,
  discardOutreach,
  listOutreach,
  listPendingApprovals,
  pendingOutreachApprovalIds,
  requestOutreachApproval,
  sendOutreach,
} from '@/lib/outreach';

type StatusFilter = 'all' | 'draft' | 'approved' | 'sent' | 'discarded';

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'approved', label: 'Approved' },
  { key: 'sent', label: 'Sent' },
  { key: 'discarded', label: 'Discarded' },
];

const statusTone: Record<string, string> = {
  draft: 'border-[hsl(var(--border))] text-fg-subtle',
  approved: 'border-accent/40 bg-accent/10 text-accent',
  sent: 'border-success/35 bg-success/10 text-success',
  discarded: 'border-[hsl(var(--border))] text-fg-faint',
};

/**
 * F.5 outreach composer. Composition, the approval-queue handoff, and the send
 * transition all call the real `/outreach/*` endpoints. A draft only becomes
 * sendable after its `outreach_email` approval is approved and a Gmail draft is
 * staged (WS2's `/send`).
 */
export function OutreachPanel() {
  const load = useCallback(async () => {
    const [messages, approvals] = await Promise.all([listOutreach(), listPendingApprovals()]);
    return { messages, pending: pendingOutreachApprovalIds(approvals.items) };
  }, []);
  const { data, error, refetch } = useApi(load);

  const [tab, setTab] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState<string>(OUTREACH_TEMPLATE_IDS[0]);
  const [variant, setVariant] = useState<string>('default');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [timezone, setTimezone] = useState('');
  const [context, setContext] = useState('');
  const [composing, setComposing] = useState(false);
  const [composeNotice, setComposeNotice] = useState<string | null>(null);

  const messages = useMemo(() => data?.messages ?? [], [data]);
  const pending = data?.pending;

  const visible = useMemo(
    () => (tab === 'all' ? messages : messages.filter((m) => m.status === tab)),
    [messages, tab],
  );

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      all: messages.length,
      draft: 0,
      approved: 0,
      sent: 0,
      discarded: 0,
    };
    for (const m of messages) {
      if (m.status in base) base[m.status as StatusFilter] += 1;
    }
    return base;
  }, [messages]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function onCompose(event: FormEvent) {
    event.preventDefault();
    setComposing(true);
    setComposeNotice(null);
    try {
      const recipient: { email: string; name?: string; role?: string; company?: string; timezone?: string; context?: string } =
        { email: email.trim() };
      if (name.trim()) recipient.name = name.trim();
      if (role.trim()) recipient.role = role.trim();
      if (company.trim()) recipient.company = company.trim();
      if (timezone.trim()) recipient.timezone = timezone.trim();
      if (context.trim()) recipient.context = context.trim();

      const result = await composeOutreach({ templateId, industryVariant: variant, recipient });
      if (!result.ok) {
        setComposeNotice(result.reason ?? 'The draft was refused by the fact-check gate.');
      } else {
        setComposeNotice(null);
        setEmail('');
        setName('');
        setRole('');
        setCompany('');
        setContext('');
        setTab('draft');
        await refetch();
      }
    } catch (e) {
      setComposeNotice((e as Error).message);
    } finally {
      setComposing(false);
    }
  }

  if (error) return <UnavailableNotice feature="Outreach" testId="outreach-unavailable" />;

  return (
    <div className="flex flex-col gap-8" data-testid="outreach-panel">
      <form
        onSubmit={onCompose}
        className="flex flex-col gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-5"
        data-testid="outreach-compose"
      >
        <h2 className="text-[15px] font-medium text-fg">Compose an outreach draft</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Template</span>
            <select
              data-testid="outreach-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="h-11 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev))/0.6] px-3.5 text-sm text-fg focus:border-accent focus:outline-none"
            >
              {OUTREACH_TEMPLATE_IDS.map((id) => (
                <option key={id} value={id}>
                  {OUTREACH_TEMPLATES[id].displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Tone variant</span>
            <select
              data-testid="outreach-variant"
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              className="h-11 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev))/0.6] px-3.5 text-sm text-fg focus:border-accent focus:outline-none"
            >
              {INDUSTRY_VARIANTS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Recipient email</span>
            <Input
              data-testid="outreach-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Recipient name</span>
            <Input data-testid="outreach-name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Their role</span>
            <Input data-testid="outreach-role" value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Company</span>
            <Input data-testid="outreach-company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Recipient timezone</span>
            <Input
              data-testid="outreach-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Kolkata (optional)"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-fg-subtle">
            Context signals <span className="text-fg-faint">(post, referrer notes, snippet)</span>
          </span>
          <textarea
            data-testid="outreach-context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            className="w-full rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev))/0.6] px-3.5 py-2.5 text-[13.5px] text-fg focus:border-accent focus:outline-none"
          />
        </label>

        {composeNotice && (
          <div
            role="alert"
            data-testid="outreach-compose-notice"
            className="rounded-[var(--radius)] border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-warn"
          >
            {composeNotice}
          </div>
        )}

        <div>
          <Button type="submit" data-testid="outreach-submit" disabled={composing}>
            {composing ? (
              <>
                <ThinkingOrb state="composing" size={20} /> Composing
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" /> Compose draft
              </>
            )}
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Outreach status filters">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-testid={`outreach-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-[12.5px] transition-colors',
              tab === t.key
                ? 'border-[hsl(var(--border-active))] bg-[hsl(var(--bg-elev-2))] text-fg'
                : 'border-[hsl(var(--border))] text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
            <span className="ml-1.5 font-mono text-[11px] text-fg-faint tabular-nums">
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {actionError && (
        <div role="alert" data-testid="outreach-action-error" className="text-[12.5px] text-danger">
          {actionError}
        </div>
      )}

      {data === null ? (
        <Loader size={64} label="Loading outreach" />
      ) : visible.length === 0 ? (
        <p
          data-testid="outreach-empty"
          className="rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-6 py-10 text-center text-[13.5px] text-fg-muted"
        >
          {messages.length === 0
            ? 'No outreach drafts yet. Compose one above; it goes to the approval queue before anything sends.'
            : 'Nothing in this filter.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="outreach-list">
          {visible.map((message) => (
            <OutreachRow
              key={message.id}
              message={message}
              awaitingApproval={
                message.status === 'draft' && Boolean(pending?.get(message.id))
              }
              busy={busyId === message.id}
              onRequestApproval={() => void run(message.id, () => requestOutreachApproval(message.id))}
              onSend={() => void run(message.id, () => sendOutreach(message.id))}
              onDiscard={() => void run(message.id, () => discardOutreach(message.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OutreachRow({
  message,
  awaitingApproval,
  busy,
  onRequestApproval,
  onSend,
  onDiscard,
}: {
  message: OutreachMessage;
  awaitingApproval: boolean;
  busy: boolean;
  onRequestApproval: () => void;
  onSend: () => void;
  onDiscard: () => void;
}) {
  return (
    <li
      data-testid="outreach-row"
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
            <span className="text-[14px] font-medium text-fg">{message.subject}</span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-[0.1em]',
                statusTone[message.status] ?? 'border-[hsl(var(--border))] text-fg-subtle',
              )}
              data-testid="outreach-status"
            >
              {message.status}
            </span>
            {awaitingApproval && (
              <span
                data-testid="outreach-awaiting"
                className="inline-flex items-center gap-1 rounded-full border border-warn/35 bg-warn/10 px-2 py-0.5 text-[10.5px] uppercase tracking-[0.1em] text-warn"
              >
                <ShieldCheck className="h-3 w-3" /> Awaiting approval
              </span>
            )}
          </div>
          <span className="text-[12.5px] text-fg-muted">
            To {message.recipientName ? `${message.recipientName} · ` : ''}
            {message.recipientEmail} · {message.templateId} · {message.industryVariant}
          </span>
          {message.sendAt && (
            <span className="text-[11.5px] text-fg-faint">
              Scheduled for {new Date(message.sendAt).toLocaleString()}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {message.status === 'draft' && !awaitingApproval && (
            <Button size="sm" data-testid="outreach-request-approval" disabled={busy} onClick={onRequestApproval}>
              {busy ? (
                <ThinkingOrb state="working" size={20} />
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" /> Send to approval queue
                </>
              )}
            </Button>
          )}
          {message.status === 'draft' && awaitingApproval && (
            <Link
              href="/approvals"
              data-testid="outreach-open-approvals"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-3 py-1.5 text-[12.5px] text-fg hover:border-accent/50 hover:text-accent"
            >
              <ShieldCheck className="h-4 w-4" /> Review in Approvals
            </Link>
          )}
          {message.status === 'approved' && (
            <Button size="sm" data-testid="outreach-send" disabled={busy} onClick={onSend}>
              {busy ? (
                <ThinkingOrb state="working" size={20} />
              ) : (
                <>
                  <Send className="h-4 w-4" /> Send now
                </>
              )}
            </Button>
          )}
          {message.status !== 'sent' && message.status !== 'discarded' && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="outreach-discard"
              disabled={busy}
              onClick={onDiscard}
            >
              <Trash2 className="h-4 w-4" /> Discard
            </Button>
          )}
        </div>
      </div>

      <details>
        <summary className="cursor-pointer text-[12.5px] text-fg-muted">View draft</summary>
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-fg" data-testid="outreach-body">
          {message.body}
        </p>
      </details>
    </li>
  );
}
