import Image from 'next/image';
import { cn } from '@careeros/ui';

// Intrinsic pixel dimensions of the exported assets, used to reserve layout
// space. Both components set `unoptimized`: these are fixed brand PNGs served
// from /public, so the image optimizer adds nothing — and on non-native
// filesystems (e.g. exFAT with macOS `._` sidecars) the optimizer can resolve
// the sidecar instead of the real file when it streams the original.
const WORDMARK = { width: 1027, height: 280 } as const;
const ICON = { width: 210, height: 200 } as const;

interface BrandProps {
  className?: string;
  alt?: string;
}

/**
 * Full "Career OS" wordmark. The export is drawn for light surfaces (dark
 * lettering), so `.brand-wordmark` lifts it to white for the default dark
 * theme while preserving the indigo accents (see globals.css).
 */
export function BrandWordmark({ className, alt = 'Career OS' }: BrandProps) {
  return (
    <Image
      src="/wordmark.png"
      alt={alt}
      width={WORDMARK.width}
      height={WORDMARK.height}
      unoptimized
      className={cn('brand-wordmark w-auto', className)}
    />
  );
}

/**
 * Square app mark (same artwork as the favicon). Decorative by default —
 * pass `alt` only when the mark has to name a link on its own.
 */
export function BrandMark({ className, alt = '' }: BrandProps) {
  return (
    <Image
      src="/icon.png"
      alt={alt}
      width={ICON.width}
      height={ICON.height}
      unoptimized
      className={cn('object-contain', className)}
    />
  );
}
