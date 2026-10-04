import Link from 'next/link';
import { DatabaseBackup, Download } from 'lucide-react';
import { Eyebrow } from '@careeros/ui';
import { UnavailableNotice } from '@/components/UnavailableNotice';

/**
 * Backup & storage (screen 63 + storage 57).
 *
 * The API exposes no backup-schedule or object-storage statistics endpoint, so
 * this screen deliberately renders the unavailable state rather than invented
 * sizes (A8). The one portable artifact the API does produce is the encrypted
 * data export, which is linked here.
 */
export default function BackupPage() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-10 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Settings · Backup &amp; storage</Eyebrow>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
          Backup &amp; storage
        </h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          What to back up, on what schedule, and which files exist only on this host. Nothing here
          is shown as a number the API cannot substantiate.
        </p>
      </header>

      <section className="flex flex-col gap-3" data-testid="backup-portable">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
          <Download className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} /> Portable copy
        </h2>
        <p className="max-w-2xl text-[12.5px] leading-relaxed text-fg-muted">
          The encrypted data export is the one archive this API can produce on demand. It contains
          every table keyed to your account plus a manifest of row counts and hashes.
        </p>
        <div>
          <Link
            href="/settings/data"
            data-testid="backup-export-link"
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-3 py-2 text-[13px] text-fg hover:border-accent/50 hover:text-accent"
          >
            <Download className="h-4 w-4" /> Go to export
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-3" data-testid="backup-status">
        <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
          <DatabaseBackup className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} /> Backup and storage
          status
        </h2>
        <UnavailableNotice feature="Backup schedule and object-storage usage" testId="backup-unavailable" />
      </section>
    </main>
  );
}
