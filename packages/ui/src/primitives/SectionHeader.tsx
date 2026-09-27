import type { ReactNode } from 'react';
import { cn } from '../utils';
import { Eyebrow } from './Eyebrow';

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  trailing?: ReactNode;
  className?: string;
  as?: 'h1' | 'h2';
}

/** Standard page/section header: eyebrow + title + optional description + trailing slot. */
export function SectionHeader({
  eyebrow,
  title,
  description,
  trailing,
  className,
  as = 'h1',
}: SectionHeaderProps) {
  const Heading = as;
  const heading =
    as === 'h1'
      ? 'text-[40px] font-semibold leading-[1.05] tracking-[-0.025em] text-fg'
      : 'text-[22px] font-semibold leading-tight tracking-[-0.015em] text-fg';
  return (
    <header className={cn('flex flex-col gap-3 md:flex-row md:items-end md:justify-between', className)}>
      <div className="flex flex-col gap-2">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Heading className={heading}>{title}</Heading>
        {description && (
          <p className="max-w-[54ch] text-[13.5px] leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </header>
  );
}
