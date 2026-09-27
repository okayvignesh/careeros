'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Briefcase, DollarSign, Globe, MapPin } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { motion } from 'framer-motion';
import { Button, Input, cn } from '@careeros/ui';
import { apiPost } from '@/lib/api-client';
import { ErrorBanner, Field } from './AccountForm';

const SENIORITY = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager'] as const;

export function GoalsForm() {
  const router = useRouter();
  const [roles, setRoles] = useState('');
  const [locations, setLocations] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [compMin, setCompMin] = useState('');
  const [compMax, setCompMax] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [seniority, setSeniority] = useState<Set<string>>(new Set(['mid', 'senior']));
  const [tz, setTz] = useState(() =>
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleSeniority(s: string) {
    setSeniority((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        targetRoles: roles.split(',').map((s) => s.trim()).filter(Boolean),
        locations: locations.split(',').map((s) => s.trim()).filter(Boolean),
        remoteOnly,
        currency,
        seniority: Array.from(seniority),
        timezone: tz,
        ...(compMin ? { compMin: Number(compMin) } : {}),
        ...(compMax ? { compMax: Number(compMax) } : {}),
      };
      await apiPost('/setup/goals', payload);
      router.push('/setup/12-health');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Field icon={Briefcase} label="Target roles">
        <Input
          value={roles}
          onChange={(e) => setRoles(e.target.value)}
          placeholder="Senior backend engineer, Staff engineer, Platform lead"
          required
        />
        <span className="text-[12.5px] text-fg-subtle">Comma-separated. First one is primary.</span>
      </Field>

      <Field icon={MapPin} label="Locations">
        <Input
          value={locations}
          onChange={(e) => setLocations(e.target.value)}
          placeholder="Remote, Bengaluru, Berlin"
          required
        />
      </Field>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={remoteOnly}
          onChange={(e) => setRemoteOnly(e.target.checked)}
          className="h-4 w-4 rounded border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] text-[hsl(var(--accent))]"
        />
        <span className="text-[13px] text-fg">Remote-only</span>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <Field icon={DollarSign} label="Comp minimum" optional>
          <Input
            type="number"
            inputMode="numeric"
            value={compMin}
            onChange={(e) => setCompMin(e.target.value)}
            placeholder="120000"
          />
        </Field>
        <Field icon={DollarSign} label="Comp maximum" optional>
          <Input
            type="number"
            inputMode="numeric"
            value={compMax}
            onChange={(e) => setCompMax(e.target.value)}
            placeholder="180000"
          />
        </Field>
      </div>

      <Field icon={DollarSign} label="Currency">
        <Input
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
          placeholder="USD"
        />
      </Field>

      <label className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-fg-muted">
          <Briefcase className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
          Seniority bands
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SENIORITY.map((s) => {
            const on = seniority.has(s);
            return (
              <motion.button
                key={s}
                type="button"
                onClick={() => toggleSeniority(s)}
                whileTap={{ scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12.5px] font-medium capitalize transition-colors duration-200',
                  on
                    ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.14)] text-fg'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] text-fg-subtle',
                )}
              >
                {s}
              </motion.button>
            );
          })}
        </div>
      </label>

      <Field icon={Globe} label="Timezone">
        <Input value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Asia/Kolkata" />
        <span className="text-[12.5px] text-fg-subtle">
          IANA name. Detected from your browser; edit if you prefer a different one.
        </span>
      </Field>

      {err && <ErrorBanner message={err} />}

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" size="lg" disabled={busy || seniority.size === 0}>
          {busy ? (
            <>
              <ThinkingOrb state="working" size={20} /> Saving…
            </>
          ) : (
            <>
              Save and continue <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
