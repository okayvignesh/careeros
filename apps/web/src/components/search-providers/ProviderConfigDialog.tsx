'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { Button, Input } from '@careeros/ui';
import type { SearchProvider } from '@careeros/shared';
import { Dialog } from '@/components/Dialog';
import { apiPut } from '@/lib/api-client';
import { providerView } from './providers-data';

/**
 * Build the `PUT /me/search-providers/:id` body from the loaded provider plus
 * the form's transient values. Public fields are always sent (an empty string
 * clears them); secret fields are sent only when the user typed a new value, so
 * a blank secret preserves the stored one. Pure so the contract is testable
 * without jsdom.
 */
export function buildProviderPayload(
  provider: Pick<SearchProvider, 'fields'>,
  values: Record<string, string>,
): { values: Record<string, string> } {
  const out: Record<string, string> = {};
  for (const field of provider.fields) {
    const value = values[field.name] ?? '';
    if (field.secret) {
      if (value.trim().length > 0) out[field.name] = value;
    } else {
      out[field.name] = value;
    }
  }
  return { values: out };
}

interface ProviderConfigDialogProps {
  provider: SearchProvider;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: SearchProvider) => void;
}

export function ProviderConfigDialog({
  provider,
  open,
  onClose,
  onSaved,
}: ProviderConfigDialogProps) {
  const initial = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of provider.fields) values[field.name] = provider.values[field.name] ?? '';
    return values;
  }, [provider]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = providerView(
        await apiPut<unknown>(`/me/search-providers/${provider.id}`, buildProviderPayload(provider, values)),
      );
      onSaved(updated);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Configure ${provider.name}`}
      description="Credentials are encrypted at rest. Secrets are never shown again — leave a secret blank to keep the stored value."
      testId={`provider-config-${provider.id}`}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            data-testid={`provider-config-${provider.id}-cancel`}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={`provider-config-form-${provider.id}`}
            disabled={busy}
            data-testid={`provider-config-${provider.id}-save`}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        id={`provider-config-form-${provider.id}`}
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        {provider.fields.length === 0 ? (
          <p className="text-fg-muted text-[13px]">This provider needs no configuration.</p>
        ) : (
          provider.fields.map((field) => {
            const testId = `provider-field-${provider.id}-${field.name}`;
            const stored = field.secret && provider.has[field.name] === true;
            return (
              <label key={field.name} className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-subtle">
                  {field.secret && <KeyRound className="h-3.5 w-3.5" />}
                  {field.label}
                  {!field.required && <span className="text-fg-faint text-[11px]">(optional)</span>}
                </span>
                {field.kind === 'select' && field.options ? (
                  <select
                    data-testid={testId}
                    className="border-[hsl(var(--border))] bg-[hsl(var(--bg-elev-1))] text-fg h-9 rounded-[var(--radius)] border px-3 text-[13px] focus:border-[hsl(var(--border-active))] focus:outline-none"
                    value={values[field.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  >
                    <option value="">Default</option>
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    data-testid={testId}
                    type={field.secret ? 'password' : 'text'}
                    autoComplete={field.secret ? 'new-password' : 'off'}
                    value={values[field.name] ?? ''}
                    placeholder={
                      stored
                        ? 'Stored — leave blank to keep'
                        : (field.placeholder ?? (field.secret ? 'Enter value' : ''))
                    }
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  />
                )}
                {field.help && <span className="text-fg-faint text-[11.5px]">{field.help}</span>}
                {stored && (
                  <span
                    data-testid={`${testId}-stored`}
                    className="text-success flex items-center gap-1.5 text-[11.5px]"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Value stored
                  </span>
                )}
              </label>
            );
          })
        )}
        {error && (
          <div className="border-danger/30 bg-danger/10 text-danger rounded-[var(--radius)] border px-3.5 py-2.5 text-[13px]">
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}
