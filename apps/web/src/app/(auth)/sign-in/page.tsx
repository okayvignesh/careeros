import Link from 'next/link';
import { Eyebrow, Glass } from '@careeros/ui';
import { BrandMark } from '@/components/Brand';
import { SignInForm } from '@/components/forms/SignInForm';

export default function SignInPage() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="flex items-center gap-3">
        <BrandMark className="h-6 w-6" />
        <Eyebrow>Career OS · Sign in</Eyebrow>
      </div>

      <div className="flex flex-col gap-3">
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em]">
          Welcome back.
        </h1>
        <p className="text-[14px] text-fg-muted">Continue with your local account.</p>
      </div>

      <Glass className="p-7">
        <SignInForm />
      </Glass>

      <p className="text-[12.5px] text-fg-subtle">
        Fresh install?{' '}
        <Link href="/setup/01-preflight" className="text-[hsl(var(--accent))] hover:underline">
          Run first-time setup →
        </Link>
      </p>
    </main>
  );
}
