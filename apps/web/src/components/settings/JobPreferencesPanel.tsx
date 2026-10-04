'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Save, X } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button } from '@careeros/ui';
import { apiGet, apiPut } from '@/lib/api-client';

interface CityTarget {
  country: string;
  city: string;
}

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
  // P1 targeting profile
  workplaceTypes: string[];
  remoteScopes: string[];
  countries: string[];
  cities: CityTarget[];
  homeCountry?: string | null;
  citizenships: string[];
  workAuthorizations: string[];
  sponsorshipCountries: string[];
  relocationWilling: boolean;
  relocationCountries: string[];
  language: string;
  updatedAt: string | null;
}

const SENIORITY_OPTIONS = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager'] as const;

const WORKPLACE_OPTIONS = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
] as const;

const REMOTE_SCOPE_OPTIONS = [
  { value: 'remote_local', label: 'Local' },
  { value: 'remote_regional', label: 'Regional' },
  { value: 'remote_global', label: 'Global' },
] as const;

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

  const toggle = (key: 'workplaceTypes' | 'remoteScopes', value: string) => {
    const current = prefs[key];
    set(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <Section title="What you're looking for">
        <Field
          label="Target roles"
          hint="Comma-separated. Free text for now; a role classifier lands with the analysis slice."
        >
          <CsvInput
            testId="prefs-target-roles"
            value={prefs.targetRoles}
            onChange={(v) => set('targetRoles', v)}
            placeholder="Senior Backend Engineer, Staff SRE"
          />
        </Field>

        <Field label="Seniority bands" hint="Check any that fit.">
          <div className="flex flex-wrap gap-2">
            {SENIORITY_OPTIONS.map((band) => (
              <Chip
                key={band}
                testId={`prefs-seniority-${band}`}
                active={prefs.seniority.includes(band)}
                onClick={() =>
                  set(
                    'seniority',
                    prefs.seniority.includes(band)
                      ? prefs.seniority.filter((s) => s !== band)
                      : [...prefs.seniority, band],
                  )
                }
              >
                {band}
              </Chip>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Where you'll work">
        <Field
          label="Workplace types"
          hint="Soft signal only — a mismatch never hides a job, it just ranks lower."
        >
          <div className="flex flex-wrap gap-2">
            {WORKPLACE_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                testId={`prefs-workplace-${opt.value}`}
                active={prefs.workplaceTypes.includes(opt.value)}
                onClick={() => toggle('workplaceTypes', opt.value)}
              >
                {opt.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field
          label="Remote scope"
          hint="Applies to remote roles: how far from your location you'll consider."
        >
          <div className="flex flex-wrap gap-2">
            {REMOTE_SCOPE_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                testId={`prefs-remote-scope-${opt.value}`}
                active={prefs.remoteScopes.includes(opt.value)}
                onClick={() => toggle('remoteScopes', opt.value)}
              >
                {opt.label}
              </Chip>
            ))}
          </div>
        </Field>

        <div className="flex items-center gap-3">
          <input
            id="remoteOnly"
            data-testid="prefs-remote-only"
            type="checkbox"
            checked={prefs.remoteOnly}
            onChange={(e) => set('remoteOnly', e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="remoteOnly" className="text-[13.5px] text-fg">
            Remote-only (hard filter — hides onsite and hybrid roles)
          </label>
        </div>

        <Field
          label="Target countries"
          hint="ISO alpha-2 codes. Drives scoped ingest and the location soft signal."
        >
          <CsvInput
            testId="prefs-countries"
            value={prefs.countries}
            onChange={(v) => set('countries', v.map((c) => c.toUpperCase()))}
            placeholder="US, DE, IN"
          />
        </Field>

        <Field label="Target cities" hint="Optional. Narrows a country to a specific city.">
          <div className="flex flex-col gap-2">
            {prefs.cities.map((city, i) => (
              <div key={`${city.country}-${city.city}-${i}`} className="flex items-center gap-2">
                <input
                  data-testid={`prefs-city-country-${i}`}
                  type="text"
                  maxLength={2}
                  value={city.country}
                  onChange={(e) => {
                    const next = [...prefs.cities];
                    next[i] = { ...city, country: e.target.value.toUpperCase() };
                    set('cities', next);
                  }}
                  placeholder="US"
                  className="w-16 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-2 py-1.5 font-mono text-[13px] uppercase text-fg focus:border-accent focus:outline-none"
                />
                <input
                  data-testid={`prefs-city-name-${i}`}
                  type="text"
                  value={city.city}
                  onChange={(e) => {
                    const next = [...prefs.cities];
                    next[i] = { ...city, city: e.target.value };
                    set('cities', next);
                  }}
                  placeholder="Austin"
                  className="flex-1 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3 py-1.5 text-[13px] text-fg focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  data-testid={`prefs-city-remove-${i}`}
                  aria-label="Remove city"
                  onClick={() => set('cities', prefs.cities.filter((_, j) => j !== i))}
                  className="rounded border border-[hsl(var(--border))] p-1.5 text-fg-faint hover:border-danger/40 hover:text-danger"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              data-testid="prefs-city-add"
              onClick={() => set('cities', [...prefs.cities, { country: '', city: '' }])}
              className="inline-flex w-fit items-center gap-1 rounded border border-[hsl(var(--border))] px-2 py-1 text-[12px] text-fg-muted hover:border-accent/40 hover:text-accent"
            >
              <Plus className="h-3 w-3" /> Add city
            </button>
          </div>
        </Field>
      </Section>

      <Section title="Work authorization">
        <Field
          label="Home country"
          hint="ISO alpha-2. Counts as authorized and anchors the relocation signal."
        >
          <input
            data-testid="prefs-home-country"
            type="text"
            maxLength={2}
            value={prefs.homeCountry ?? ''}
            onChange={(e) => set('homeCountry', e.target.value ? e.target.value.toUpperCase() : null)}
            placeholder="IN"
            className="w-24 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3 py-1.5 font-mono text-[13px] uppercase text-fg focus:border-accent focus:outline-none"
          />
        </Field>

        <Field label="Citizenships" hint="ISO alpha-2 codes, comma-separated.">
          <CsvInput
            testId="prefs-citizenships"
            value={prefs.citizenships}
            onChange={(v) => set('citizenships', v.map((c) => c.toUpperCase()))}
            placeholder="IN"
          />
        </Field>

        <Field
          label="Work authorizations"
          hint="Countries where you already have the right to work (no sponsorship needed)."
        >
          <CsvInput
            testId="prefs-work-authorizations"
            value={prefs.workAuthorizations}
            onChange={(v) => set('workAuthorizations', v.map((c) => c.toUpperCase()))}
            placeholder="IN, AE"
          />
        </Field>

        <Field
          label="Will accept sponsorship in"
          hint="Countries where a likely-sponsoring employer counts as eligible."
        >
          <CsvInput
            testId="prefs-sponsorship-countries"
            value={prefs.sponsorshipCountries}
            onChange={(v) => set('sponsorshipCountries', v.map((c) => c.toUpperCase()))}
            placeholder="DE, NL, CA"
          />
        </Field>

        <div className="flex items-center gap-3">
          <input
            id="relocationWilling"
            data-testid="prefs-relocation-willing"
            type="checkbox"
            checked={prefs.relocationWilling}
            onChange={(e) => set('relocationWilling', e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="relocationWilling" className="text-[13.5px] text-fg">
            Willing to relocate
          </label>
        </div>

        <Field label="Relocation countries" hint="ISO alpha-2 codes, comma-separated.">
          <CsvInput
            testId="prefs-relocation-countries"
            value={prefs.relocationCountries}
            onChange={(v) => set('relocationCountries', v.map((c) => c.toUpperCase()))}
            placeholder="DE, NL"
          />
        </Field>
      </Section>

      <Section title="Compensation and filters">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Comp min (annual)" hint="Integer, in the currency below.">
            <NumberInput
              testId="prefs-comp-min"
              value={prefs.compMin ?? undefined}
              onChange={(v) => set('compMin', v)}
              placeholder="100000"
            />
          </Field>
          <Field label="Comp max (annual)" hint="">
            <NumberInput
              testId="prefs-comp-max"
              value={prefs.compMax ?? undefined}
              onChange={(v) => set('compMax', v)}
              placeholder="200000"
            />
          </Field>
          <Field label="Currency" hint="3-letter code.">
            <input
              data-testid="prefs-currency"
              type="text"
              maxLength={3}
              value={prefs.currency}
              onChange={(e) => set('currency', e.target.value.toUpperCase())}
              className="w-full rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3 py-1.5 font-mono text-[13px] uppercase text-fg focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <Field label="Legacy locations" hint="Free text, still read by market briefs.">
          <CsvInput
            testId="prefs-locations"
            value={prefs.locations}
            onChange={(v) => set('locations', v)}
            placeholder="Bangalore, Berlin, Remote"
          />
        </Field>

        <Field label="Must-have skills" hint="Skill IDs from your catalogue. Job must have all of these.">
          <CsvInput
            testId="prefs-must-have"
            value={prefs.mustHaveSkills}
            onChange={(v) => set('mustHaveSkills', v)}
            placeholder="ts, react, aws"
          />
        </Field>

        <Field label="Dealbreaker skills" hint="Skill IDs. Any hit excludes the job.">
          <CsvInput
            testId="prefs-dealbreakers"
            value={prefs.dealbreakerSkills}
            onChange={(v) => set('dealbreakerSkills', v)}
            placeholder="cobol, java"
          />
        </Field>

        <Field label="Company blacklist" hint="Case-insensitive company names.">
          <CsvInput
            testId="prefs-company-blacklist"
            value={prefs.companyBlacklist}
            onChange={(v) => set('companyBlacklist', v)}
            placeholder="AcmeCorp, ExampleInc"
          />
        </Field>
      </Section>

      {error && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={saving} data-testid="prefs-save">
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-[hsl(var(--border))] pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-[13px] font-medium text-fg-subtle">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-fg-subtle">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-fg-faint">{hint}</span>}
    </label>
  );
}

function Chip({
  testId,
  active,
  onClick,
  children,
}: {
  testId: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={
        'rounded border px-2 py-1 text-[12px] transition-colors ' +
        (active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-[hsl(var(--border))] text-fg-muted hover:border-[hsl(var(--border-active))]')
      }
    >
      {children}
    </button>
  );
}

function CsvInput({
  testId,
  value,
  onChange,
  placeholder,
}: {
  testId: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  return (
    <input
      data-testid={testId}
      type="text"
      value={value.join(', ')}
      onChange={(e) =>
        onChange(
          e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        )
      }
      placeholder={placeholder}
      className="w-full rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3 py-1.5 text-[13px] text-fg focus:border-accent focus:outline-none"
    />
  );
}

function NumberInput({
  testId,
  value,
  onChange,
  placeholder,
}: {
  testId: string;
  value: number | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      data-testid={testId}
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
