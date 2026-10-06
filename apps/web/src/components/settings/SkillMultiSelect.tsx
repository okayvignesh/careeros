'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { cn } from '@careeros/ui';
import { apiGet } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';

interface CatalogueSkill {
  id: string;
  name: string;
  cluster: string;
  proficiency: number;
  evidenceCount: number;
}

/**
 * Skill picker for job preferences. Multi-select from the ESCO catalogue
 * (`GET /me/skills`) with a custom free-text option, since the backend filter
 * compares against catalogue ids but users may want a term we don't carry yet.
 * Replaces the old "type skill IDs by hand" CSV input.
 */
export function SkillMultiSelect({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  testId?: string;
}) {
  const load = useCallback(() => apiGet<CatalogueSkill[]>('/me/skills'), []);
  const { data } = useApi<CatalogueSkill[]>(load);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const catalogue = useMemo(() => data ?? [], [data]);
  const byId = useMemo(() => new Map(catalogue.map((s) => [s.id, s])), [catalogue]);
  // Skills the user already has evidence for float to the top.
  const ranked = useMemo(
    () =>
      [...catalogue].sort(
        (a, b) => b.evidenceCount - a.evidenceCount || a.name.localeCompare(b.name),
      ),
    [catalogue],
  );
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = q
      ? ranked.filter(
          (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
        )
      : ranked;
    return list.slice(0, 50);
  }, [ranked, q]);

  const already = (id: string) => value.some((v) => v.toLowerCase() === id.toLowerCase());
  const customAddable =
    q.length > 0 &&
    !already(query.trim()) &&
    !matches.some((s) => s.name.toLowerCase() === q || s.id.toLowerCase() === q);

  function add(raw: string) {
    const id = raw.trim();
    if (!id || already(id)) return;
    onChange([...value, id]);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-2 py-1.5 focus-within:border-accent">
        {value.map((id) => (
          <span
            key={id}
            data-testid={testId ? `${testId}-chip-${id}` : undefined}
            className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-2))] px-2 py-[1px] text-[11.5px] text-fg"
          >
            {byId.get(id)?.name ?? id}
            <button
              type="button"
              aria-label={`Remove ${id}`}
              onClick={() => remove(id)}
              className="text-fg-subtle transition-colors hover:text-fg"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          data-testid={testId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(matches[0]?.id ?? query);
            } else if (e.key === 'Escape') {
              setOpen(false);
            } else if (e.key === 'Backspace' && !query && value.length > 0) {
              remove(value[value.length - 1]!);
            }
          }}
          placeholder={value.length === 0 ? placeholder : ''}
          className="min-w-[8rem] flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
        />
      </div>

      {open && (matches.length > 0 || customAddable) && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] p-1 shadow-lg"
          >
            {customAddable && (
              <li>
                <button
                  type="button"
                  onClick={() => add(query.trim())}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-fg-muted transition-colors hover:bg-[hsl(var(--bg-elev-2))] hover:text-fg"
                >
                  <Plus className="h-3.5 w-3.5" /> Add custom &ldquo;{query.trim()}&rdquo;
                </button>
              </li>
            )}
            {matches.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  data-testid={testId ? `${testId}-option-${s.id}` : undefined}
                  onClick={() => add(s.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[hsl(var(--bg-elev-2))] hover:text-fg',
                    value.includes(s.id) ? 'text-accent' : 'text-fg-muted',
                  )}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[10.5px] text-fg-faint">
                    {s.evidenceCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[hsl(var(--success))]">
                        <Check className="h-3 w-3" />
                        {s.evidenceCount}
                      </span>
                    )}
                    <span className="font-mono">{s.id}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
