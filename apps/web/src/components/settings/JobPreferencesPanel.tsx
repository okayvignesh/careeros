'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button } from '@careeros/ui';
import { apiGet, apiPut } from '@/lib/api-client';

interface JobPreferences {
  targetRoles: string[];
  locations: string[];
  remoteOnly: boolean;
  compMin?: number | null;
  compMax?: number | null;
  currency: string;
  seniority: string[];
  mustHaveSkills: string[];
  dealbreakerSkills: string[];
  companyBlacklist: string[];
  updatedAt: string | null;
}

const SENIORITY_OPTIONS = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager'] as const;

export function JobPreferencesPanel() {
  const [prefs, setPrefs] = useState<JobPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    apiGet<JobPreferences>('/me/job-preferences')
      .then((p) => {
        setPrefs(p);
        setSavedAt(p.updatedAt);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await apiPut<JobPreferences>('/me/job-preferences', prefs);
      setPrefs(saved);
      setSavedAt(saved.updatedAt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !prefs) {
    return (
      <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!prefs) return <Skeleton />;

  const set = <K extends keyof JobPreferences>(k: K, v: JobPreferences[K]) =>
    setPrefs({ ...prefs, [k]: v });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Field label="Target roles" hint="Comma-separated. Free text for now; a role classifier lands with the analysis slice.">
        <CsvInput value={prefs.targetRoles} onChange={(v) => set('targetRoles', v)} placeholder="Senior Backend Engineer, Staff SRE" />
      </Field>

      <Field label="Locations" hint="Cities or countries you'd take.">
        <CsvInput value={prefs.locations} onChange={(v) => set('locations', v)} placeholder="Bangalore, Berlin, Remote" />
      </Field>

      <div className="flex items-center gap-3">
        <input
          id="remoteOnly"
          type="checkbox"
          checked={prefs.remoteOnly}
          onChange={(e) => set('remoteOnly', e.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="remoteOnly" className="text-[13.5px] text-fg">
          Remote-only
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Comp min (annual)" hint="Integer, in the currency below.">
          <NumberInput
            value={prefs.compMin ?? undefined}
            onChange={(v) => set('compMin', v)}
            placeholder="100000"
          />
        </Field>
        <Field label="Comp max (annual)" hint="">
          <NumberInput
            value={prefs.compMax ?? undefined}
            onChange={(v) => set('compMax', v)}
            placeholder="200000"
          />
        </Field>
        <Field label="Currency" hint="3-letter code.">
          <input
            type="text"
            maxLength={3}
            value={prefs.currency}
            onChange={(e) => set('currency', e.target.value.toUpperCase())}
            className="w-full rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3 py-1.5 font-mono text-[13px] uppercase text-fg focus:border-accent focus:outline-none"
          />
        </Field>
      </div>

      <Field label="Seniority bands" hint="Check any that fit.">
        <div className="flex flex-wrap gap-2">
          {SENIORITY_OPTIONS.map((band) => {
            const active = prefs.seniority.includes(band);
            return (
              <button
                key={band}
                type="button"
                onClick={() =>
                  set(
                    'seniority',
                    active ? prefs.seniority.filter((s) => s !== band) : [...prefs.seniority, band],
                  )
                }
                className={
                  'rounded border px-2 py-1 text-[12px] transition-colors ' +
                  (active
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-[hsl(var(--border))] text-fg-muted hover:border-[hsl(var(--border-active))]')
                }
              >
                {band}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Must-have skills" hint="Skill IDs from your catalogue. Job must have all of these.">
        <CsvInput value={prefs.mustHaveSkills} onChange={(v) => set('mustHaveSkills', v)} placeholder="ts, react, aws" />
      </Field>

      <Field label="Dealbreaker skills" hint="Skill IDs. Any hit excludes the job.">
        <CsvInput value={prefs.dealbreakerSkills} onChange={(v) => set('dealbreakerSkills', v)} placeholder="cobol, java" />
      </Field>

      <Field label="Company blacklist" hint="Case-insensitive company names.">
        <CsvInput value={prefs.companyBlacklist} onChange={(v) => set('companyBlacklist', v)} placeholder="AcmeCorp, ExampleInc" />
      </Field>

      {error && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <ThinkingOrb state="working" size={20} /> Saving
            </>
          ) : (
            <>
              Save preferences <Save className="h-4 w-4" />
            </>
          )}
        </Button>
        {savedAt && (
          <span className="text-[11.5px] text-fg-faint">
            Saved {new Date(savedAt).toLocaleString()}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-fg-subtle">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-fg-faint">{hint}</span>}
    </label>
  );
}

function CsvInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  // Keep the raw text locally so spaces and commas survive while typing; the
  // parent only needs the parsed array. Previously the input rendered
  // `value.join(', ')` and re-parsed every keystroke, which trimmed the
  // trailing space and dropped the comma — multi-word entries were impossible.
  const [text, setText] = useState(() => value.join(', '));
  return (
    <input
      type="text"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        onChange(
          raw
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        );
      }}
      placeholder={placeholder}
      className="w-full rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3 py-1.5 text-[13px] text-fg focus:border-accent focus:outline-none"
    />
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      placeholder={placeholder}
      className="w-full rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3 py-1.5 font-mono text-[13px] text-fg focus:border-accent focus:outline-none"
    />
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-[var(--radius)] bg-[hsl(var(--bg-elev-1))]" />
      ))}
    </div>
  );
}
