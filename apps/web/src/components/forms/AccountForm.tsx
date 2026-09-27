'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound, Mail, User, type LucideIcon } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';

export function AccountForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiPost('/setup/account', { email, password, displayName: displayName || undefined });
      router.push('/setup/03-provider');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Field icon={Mail} label="Email">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </Field>

      <Field
        icon={KeyRound}
        label="Password"
        hint="At least 12 characters. Hashed with Argon2id, never stored in plaintext."
      >
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          placeholder="••••••••••••"
          required
        />
      </Field>

      <Field icon={User} label="Display name" optional>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="How you want to be greeted"
        />
      </Field>

      {err && <ErrorBanner message={err} />}

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Creating account…
            </>
          ) : (
            <>
              Create account <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

export function Field({
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
    <label className="flex flex-col gap-2">
      <span className="flex items-center gap-2 text-[13px] font-medium text-fg-muted">
        <Icon className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
        {label}
        {optional && <span className="text-fg-faint font-normal">Optional</span>}
      </span>
      {children}
      {hint && <span className="text-[12.5px] leading-relaxed text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="rounded-[var(--radius)] border border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.06)] px-3.5 py-2.5 text-[13px] text-[hsl(var(--danger))]">
      {message}
    </p>
  );
}
