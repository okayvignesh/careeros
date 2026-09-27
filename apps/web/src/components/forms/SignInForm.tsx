'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound, Mail } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button, Input } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { ErrorBanner, Field } from './AccountForm';

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiPost('/auth/sign-in', { email, password });
      router.push('/dashboard');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field icon={Mail} label="Email">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </Field>
      <Field icon={KeyRound} label="Password">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      {err && <ErrorBanner message={err} />}
      <Button type="submit" size="lg" className="mt-2" disabled={busy}>
        {busy ? (
          <>
            <ThinkingOrb state="working" size={20} /> Signing in…
          </>
        ) : (
          <>
            Sign in <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}
