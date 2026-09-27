import { ThinkingOrb } from 'thinking-orbs';
import { cn } from '@careeros/ui';

interface Props {
  /** ThinkingOrb size preset. 20 = inline, 64 = centerpiece. */
  size?: 20 | 64;
  /** Which orb animation to run. Defaults to 'working'. */
  state?: 'working' | 'searching' | 'solving' | 'listening' | 'connecting' | 'weaving' | 'composing' | 'breathing' | 'shaping';
  /** Optional label rendered next to the orb. */
  label?: string;
  /** Extra classes for the wrapper. */
  className?: string;
  /** Center the orb + label inside the wrapper. */
  center?: boolean;
}

/**
 * Standard loading indicator for async panels. Always renders `<ThinkingOrb>` (per PLAN.md
 * loader convention). Use `center` for full-panel loading; omit for inline.
 */
export function Loader({ size = 20, state = 'working', label, className, center = true }: Props) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[12.5px] text-fg-subtle',
        center && 'justify-center py-6',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <ThinkingOrb state={state} size={size} />
      {label && <span>{label}</span>}
    </div>
  );
}
