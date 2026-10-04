import type { AiAssistLevel } from './types';

/** Stacked-bar palette. Index-stable so a language keeps its colour across repos. */
const CHART_COLORS = [
  'hsl(var(--accent))',
  'hsl(173 72% 48%)',
  'hsl(var(--warn))',
  'hsl(268 68% 68%)',
  'hsl(var(--success))',
  'hsl(210 12% 55%)',
] as const;

export function colorForIndex(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0];
}

export interface Tone {
  label: string;
  className: string;
  dotClassName: string;
  description: string;
}

const AI_TONES: Record<AiAssistLevel, Tone> = {
  high: {
    label: 'High',
    className: 'border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.10)] text-[hsl(var(--danger))]',
    dotClassName: 'bg-[hsl(var(--danger))]',
    description: 'Commit patterns resemble generated code. Review, and be ready to defend this independently.',
  },
  medium: {
    label: 'Medium',
    className: 'border-[hsl(var(--warn)/0.35)] bg-[hsl(var(--warn)/0.10)] text-[hsl(var(--warn))]',
    dotClassName: 'bg-[hsl(var(--warn))]',
    description: 'Some commits show generation-like patterns. Make sure you can explain and modify the code.',
  },
  low: {
    label: 'Low',
    className: 'border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.10)] text-[hsl(var(--success))]',
    dotClassName: 'bg-[hsl(var(--success))]',
    description: 'Commit patterns look hand-written. Keep your dependency risk low by staying close to the code.',
  },
  unavailable: {
    label: 'Not available',
    className: 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-subtle',
    dotClassName: 'bg-fg-faint',
    description: 'No commits were analysed for this repository yet.',
  },
};

export function aiTone(level: AiAssistLevel): Tone {
  return AI_TONES[level];
}

/** Strength 1..5 → tone class for the strength pill. */
export function strengthTone(strength: number): string {
  if (strength >= 4) return 'border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.10)] text-[hsl(var(--success))]';
  if (strength >= 3) return 'border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.10)] text-[hsl(var(--accent))]';
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-subtle';
}

/**
 * All formatting is client-side via Intl (AGENTS.md §6 timezone). `timeZone` is
 * left to the runtime so the browser uses the user's zone.
 */
export function formatDate(iso: string | null): string {
  if (!iso) return 'not yet analysed';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'not yet analysed';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function monthDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}
