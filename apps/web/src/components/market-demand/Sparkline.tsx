import { polylinePoints, trendDirection } from './chart-geometry';

interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  ariaLabel: string;
  /** Force a tone; otherwise derived from trend direction. */
  tone?: 'rising' | 'declining' | 'steady';
}

/**
 * Quiet inline-SVG sparkline. No lib, no axes, no tooltip. The line picks up
 * its stroke from the trend direction: accent for rising, warn for declining,
 * subtle for steady.
 */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  ariaLabel,
  tone,
}: SparklineProps) {
  const dir = tone ?? trendDirection(values);
  const stroke =
    dir === 'rising'
      ? 'hsl(var(--accent))'
      : dir === 'declining'
        ? 'hsl(var(--warn))'
        : 'hsl(var(--fg-faint))';
  const points = polylinePoints(values, width, height);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="overflow-visible"
    >
      {points && (
        <polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
