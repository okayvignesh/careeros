'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, ExternalLink, Github, KeyRound } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button, Input } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { ErrorBanner, Field } from './AccountForm';

interface GithubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  publicRepos: number;
  followers: number;
}

export function GithubForm({ initial }: { initial?: GithubProfile | null }) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [profile, setProfile] = useState<GithubProfile | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const p = await apiPost<GithubProfile>('/setup/github', { token });
      setProfile(p);
      setToken('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    router.push('/setup/08-integrations');
    router.refresh();
  }

  if (profile) {
    return (
      <div className="flex flex-col gap-5">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="panel flex items-center gap-4 p-5"
        >
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-12 w-12 rounded-full border border-[hsl(var(--border-strong))]"
          />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[14px] font-medium text-fg">
              <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" strokeWidth={2.4} />
              Connected as @{profile.login}
            </span>
            <span className="text-[12.5px] text-fg-subtle">
              {profile.name ? `${profile.name} · ` : ''}
              {profile.publicRepos} public repos · {profile.followers} followers
            </span>
          </div>
        </motion.div>

        <div className="flex items-center gap-3">
          <Link href="/setup/08-integrations">
            <Button size="lg">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field
        icon={KeyRound}
        label="Personal access token"
        hint="Generate a fine-grained PAT with read access to your repos. Stored encrypted at rest."
      >
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          required
        />
      </Field>

      <a
        href="https://github.com/settings/personal-access-tokens/new"
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-fg-muted transition-colors hover:text-fg"
      >
        <Github className="h-3.5 w-3.5" strokeWidth={1.8} />
        Create a fine-grained token
        <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
      </a>

      {err && <ErrorBanner message={err} />}

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" size="lg" disabled={busy || !token}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Verifying…
            </>
          ) : (
            <>
              Connect <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={skip}>
          Skip for now
        </Button>
      </div>
    </form>
  );
}
