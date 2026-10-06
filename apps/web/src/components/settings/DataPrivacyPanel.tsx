'use client';

import { useCallback, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, Lock, ShieldAlert, Trash2 } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input } from '@careeros/ui';
import { Dialog } from '@/components/Dialog';
import { useApi } from '@/lib/use-api';
import {
  type ApprovalPage,
  type ExportResult,
  deleteAccount,
  exportAccountData,
  formatBytes,
  listPendingApprovals,
  reauthenticate,
} from '@/lib/data-privacy';

const SENSITIVITY_LABELS = [
  { label: 'Public', detail: 'Job postings, engineering blogs, public repositories.', model: 'Sent to the model', vector: 'Indexed' },
  { label: 'Personal', detail: 'Resume, goals, assessment answers.', model: 'Sent to the model', vector: 'Indexed' },
  { label: 'Confidential', detail: 'Private repositories marked analysable.', model: 'Summaries only', vector: 'Indexed' },
  { label: 'Employer-confidential', detail: 'Repositories marked restricted.', model: 'Never sent', vector: 'Never indexed' },
] as const;

/**
 * F.8 data & privacy: export everything and delete the account. Both routes
 * require a session younger than 5 minutes, so each flow re-authenticates with
 * the account password first. A pending `delete_account` approval item (if one
 * exists) is surfaced and linked to the approval queue rather than duplicated.
 */
export function DataPrivacyPanel() {
  const router = useRouter();
  const loadApprovals = useCallback(() => listPendingApprovals(), []);
  const { data: approvals } = useApi<ApprovalPage>(loadApprovals);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportEmail, setExportEmail] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const pendingDelete = (approvals?.items ?? []).filter((a) => a.kind === 'delete_account');

  function closeExport() {
    setExportOpen(false);
    setExportError(null);
    setExportResult(null);
    setExportPassword('');
  }

  async function onExport(event: FormEvent) {
    event.preventDefault();
    setExportBusy(true);
    setExportError(null);
    try {
      await reauthenticate(exportEmail.trim(), exportPassword);
      setExportResult(await exportAccountData());
      setExportPassword('');
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  }

  async function onDelete(event: FormEvent) {
    event.preventDefault();
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await reauthenticate(deleteEmail.trim(), deletePassword);
      await deleteAccount(deleteEmail.trim());
      router.push('/sign-in');
    } catch (e) {
      setDeleteError((e as Error).message);
      setDeleteBusy(false);
    }
  }

  const totalRows = (exportResult?.manifest.tables ?? []).reduce((sum, t) => sum + t.rowCount, 0);

  return (
    <div className="flex flex-col gap-8">
      {pendingDelete.length > 0 && (
        <div
          data-testid="pending-deletion-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-warn/35 bg-warn/10 px-4 py-3 text-[13px] text-warn"
        >
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> An account-deletion request is waiting in the approval queue.
          </span>
          <Link href="/approvals" data-testid="pending-deletion-approvals" className="underline hover:text-fg">
            Review it in Approvals
          </Link>
        </div>
      )}

      <section className="flex flex-col gap-4" data-testid="data-export">
        <header className="flex flex-col gap-1">
          <h2 className="text-[15px] font-medium text-fg">Export everything</h2>
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-fg-muted">
            Produces a single age-encrypted archive of every table keyed to your account, plus a
            manifest of the row counts and SHA-256 hashes so you can verify the download. The
            download link expires five minutes after it is minted.
          </p>
        </header>
        <div>
          <Button
            data-testid="data-export-open"
            onClick={() => {
              setExportOpen(true);
              setExportResult(null);
              setExportError(null);
            }}
          >
            <Download className="h-4 w-4" /> Export my data
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4" data-testid="sensitivity-legend">
        <header className="flex flex-col gap-1">
          <h2 className="text-[15px] font-medium text-fg">What leaves this host</h2>
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-fg-muted">
            Every stored object carries one sensitivity label, applied at ingestion. The label
            decides what may be sent to a model and what may be indexed.
          </p>
        </header>
        <div className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))]">
          <table className="w-full text-[13px]">
            <thead className="bg-[hsl(var(--bg-elev-1))] text-left text-[11px] uppercase tracking-[0.08em] text-fg-subtle">
              <tr>
                <th className="px-4 py-2.5 font-medium">Label</th>
                <th className="px-4 py-2.5 font-medium">What carries it</th>
                <th className="px-4 py-2.5 font-medium">To the model</th>
                <th className="px-4 py-2.5 font-medium">To the vector store</th>
              </tr>
            </thead>
            <tbody>
              {SENSITIVITY_LABELS.map((row) => (
                <tr key={row.label} className="border-t border-[hsl(var(--border))]">
                  <td className="px-4 py-2.5 font-medium text-fg">{row.label}</td>
                  <td className="px-4 py-2.5 text-fg-muted">{row.detail}</td>
                  <td className="px-4 py-2.5 text-fg-muted">{row.model}</td>
                  <td className="px-4 py-2.5 text-fg-muted">{row.vector}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="flex flex-col gap-4 rounded-[var(--radius)] border border-danger/30 bg-danger/5 p-5"
        data-testid="data-delete"
      >
        <header className="flex flex-col gap-1">
          <h2 className="text-[15px] font-medium text-fg">Delete account</h2>
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-fg-muted">
            Removes the account and every row keyed to it from Postgres, the vector store and disk.
            The audit log keeps only the record that a deletion happened. This cannot be undone and
            requires re-authentication, so it is never a single click.
          </p>
        </header>
        <div>
          <Button variant="danger" data-testid="data-delete-open" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" /> Delete account…
          </Button>
        </div>
      </section>

      <Dialog
        open={exportOpen}
        onClose={closeExport}
        title="Export my data"
        description="Confirm your password to mint the archive. Export requires a session younger than five minutes."
        testId="export-dialog"
        footer={
          exportResult ? (
            <Button data-testid="export-done" onClick={closeExport}>
              Done
            </Button>
          ) : (
            <Button variant="ghost" data-testid="export-cancel" onClick={closeExport} disabled={exportBusy}>
              Cancel
            </Button>
          )
        }
      >
        {exportResult ? (
          <div className="flex flex-col gap-4" data-testid="export-result">
            <div className="flex items-center gap-2 rounded-[var(--radius)] border border-success/30 bg-success/5 px-3.5 py-2.5 text-[13px] text-success">
              <Lock className="h-4 w-4" /> Archive ready · {formatBytes(exportResult.encryptedBytes)} ·{' '}
              {exportResult.manifest.tables.length} tables · {totalRows.toLocaleString()} rows
            </div>
            <a
              data-testid="export-download"
              href={exportResult.url}
              download
              className="inline-flex items-center gap-2 self-start rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-3 py-2 text-[13px] text-fg hover:border-accent/50 hover:text-accent"
            >
              <Download className="h-4 w-4" /> Download encrypted archive
            </a>
            <p className="text-[11.5px] text-fg-faint">
              Link expires {new Date(new Date(exportResult.manifest.exportedAt).getTime() + 5 * 60_000).toLocaleTimeString()}.
              Decrypt with your operator age key.
            </p>
          </div>
        ) : (
          <form onSubmit={onExport} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-fg-subtle">Email</span>
              <Input
                data-testid="export-email"
                type="email"
                autoComplete="email"
                required
                value={exportEmail}
                onChange={(e) => setExportEmail(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-fg-subtle">Password</span>
              <Input
                data-testid="export-password"
                type="password"
                autoComplete="current-password"
                required
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
              />
            </label>
            {exportError && (
              <div role="alert" data-testid="export-error" className="text-[12.5px] text-danger">
                {exportError}
              </div>
            )}
            <Button type="submit" data-testid="export-submit" disabled={exportBusy}>
              {exportBusy ? (
                <>
                  <ThinkingOrb state="weaving" size={20} /> Encrypting
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" /> Export
                </>
              )}
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete account"
        description="This permanently erases your account and its data. Re-authentication is required, and the action cannot be undone."
        testId="delete-dialog"
        footer={null}
      >
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[12.5px] text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Type your account email and password to confirm. Deletion runs immediately after
            confirmation and signs you out.
          </span>
        </div>
        <form onSubmit={onDelete} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">
              Email <span className="text-fg-faint">(must match your account)</span>
            </span>
            <Input
              data-testid="delete-email"
              type="email"
              autoComplete="off"
              required
              value={deleteEmail}
              onChange={(e) => setDeleteEmail(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-fg-subtle">Password</span>
            <Input
              data-testid="delete-password"
              type="password"
              autoComplete="current-password"
              required
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </label>
          {deleteError && (
            <div role="alert" data-testid="delete-error" className="text-[12.5px] text-danger">
              {deleteError}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              data-testid="delete-cancel"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="danger" data-testid="delete-submit" disabled={deleteBusy}>
              {deleteBusy ? (
                <>
                  <ThinkingOrb state="working" size={20} /> Deleting
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" /> Delete permanently
                </>
              )}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
