import { gapLabel, gapTone } from './gap-tone';

const toneClass = {
  met: 'border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.10)] text-[hsl(var(--success))]',
  default: 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-fg-subtle',
  warn: 'border-[hsl(var(--warn)/0.35)] bg-[hsl(var(--warn)/0.10)] text-[hsl(var(--warn))]',
  danger:
    'border-[hsl(var(--danger)/0.35)] bg-[hsl(var(--danger)/0.10)] text-[hsl(var(--danger))]',
} as const;

interface GapBadgeProps {
  gap: number;
}

export function GapBadge({ gap }: GapBadgeProps) {
  const tone = gapTone(gap);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums ${toneClass[tone]}`}
    >
      {gapLabel(gap)}
    </span>
  );
}
