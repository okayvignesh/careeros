'use client';

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileText, Sparkles, Upload, X } from 'lucide-react';
import { ThinkingOrb } from 'thinking-orbs';
import { Button } from '@careeros/ui';
import { ErrorBanner } from './AccountForm';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

export function ResumeParse() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setErr(null);
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      setErr('File exceeds 10 MB.');
      return;
    }
    const name = f.name.toLowerCase();
    if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
      setErr('Only PDF or DOCX resumes are supported.');
      return;
    }
    setFile(f);
  }

  function clearFile() {
    setFile(null);
    setErr(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${apiBase()}/resume/parse`, {
        method: 'POST',
        body: form,
        credentials: 'include',
        cache: 'no-store',
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) {
        throw new Error((data as { message?: string } | null)?.message ?? `Upload failed (${res.status})`);
      }
      sessionStorage.setItem('careeros:extracted-facts', JSON.stringify(data));
      router.push('/setup/10-fact-review');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-fg-muted">
          <FileText className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
          Resume file
        </span>

        {file ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-3.5 py-3">
            <div className="flex items-center gap-2.5 text-[13.5px] text-fg">
              <FileText className="h-4 w-4 text-[hsl(var(--accent))]" strokeWidth={1.7} />
              <span className="font-medium">{file.name}</span>
              <span className="text-fg-subtle">{(file.size / 1024).toFixed(0)} KB</span>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-[hsl(var(--bg-elev-2))] hover:text-fg"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-elev-1))] px-4 py-10 text-[13.5px] text-fg-muted transition-[border-color,background-color] duration-[var(--dur)] hover:border-[hsl(var(--accent)/0.7)] hover:text-fg"
          >
            <Upload className="h-5 w-5 text-fg-subtle" strokeWidth={1.7} />
            <span>
              <span className="font-medium text-fg">Click to upload</span> your resume
            </span>
            <span className="text-[12.5px] text-fg-subtle">PDF or DOCX, up to 10 MB</span>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={onPick}
          className="hidden"
        />

        <span className="text-[12.5px] text-fg-subtle">
          We parse the file, extract text, and pull structured facts using your configured AI provider.
        </span>
      </label>

      {err && <ErrorBanner message={err} />}

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" size="lg" disabled={busy || !file}>
          {busy ? (
            <>
              <ThinkingOrb state="solving" size={20} /> Extracting facts…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" /> Extract facts
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
