import { Download, Github, KeyRound, MonitorSmartphone, ShieldAlert } from 'lucide-react';
import { Eyebrow } from '@careeros/ui';
import { DESKTOP_RELEASES_URL } from '@/lib/agent';

const steps = [
  'Download the installer for your OS from GitHub Releases (macOS .dmg, Windows .exe, Linux .AppImage).',
  'Install and launch the agent. A tray icon appears on your machine.',
  'In the agent tray, choose “Pair device”.',
  'Click “Add device” above, copy the 6-digit code, and paste it into the agent. The tray turns green when connected.',
];

/**
 * D.3 getting-started panel. Artifacts are published by
 * `.github/workflows/desktop-release.yml` on `desktop-v*` tags; this links to
 * the GitHub Releases hub rather than the GitHub API so the page stays static
 * and needs no token.
 */
export function AgentDownloadCard() {
  return (
    <section
      data-testid="agent-download"
      className="flex flex-col gap-5 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] px-5 py-5"
    >
      <header className="flex flex-col gap-2">
        <Eyebrow>Desktop companion</Eyebrow>
        <h2 className="text-[17px] font-semibold text-fg">Download the agent</h2>
        <p className="max-w-2xl text-[13px] leading-relaxed text-fg-muted">
          The agent runs on your own machine so LinkedIn and Indeed browsing, plus ATS form-fills, use
          your real logged-in browser session and IP — never the VPS.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={DESKTOP_RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="agent-download-link"
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius)] bg-[hsl(var(--accent))] px-4 text-[13.5px] font-medium text-[hsl(var(--accent-fg))] transition-[filter] duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
        >
          <Download className="h-4 w-4" /> Download latest release
        </a>
        <a
          href={DESKTOP_RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="agent-releases-link"
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] px-4 text-[13.5px] font-medium text-fg-muted transition-colors duration-200 hover:border-[hsl(var(--border-active))] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
        >
          <Github className="h-4 w-4" /> All releases
        </a>
      </div>

      <ol className="flex flex-col gap-2.5" data-testid="pairing-steps">
        {steps.map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-[13px] leading-relaxed text-fg-muted">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--border-strong))] font-mono text-[11px] text-fg-subtle">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11.5px] text-fg-faint">
        <span className="inline-flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" /> Credentials stay in your OS keychain.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MonitorSmartphone className="h-3.5 w-3.5" /> macOS, Windows, Linux.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5" /> Unsigned MVP build — expect a Gatekeeper /
          SmartScreen prompt.
        </span>
      </div>
    </section>
  );
}
