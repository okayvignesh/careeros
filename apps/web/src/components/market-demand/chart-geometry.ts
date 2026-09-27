/**
 * Pure geometry helpers for the "quiet" inline SVG charts used by market
 * screens (33 skill demand, 34 trends). No React, no DOM. Kept pure so a
 * vitest .ts file can exercise every branch without jsdom.
 *
 * ponytail: SVG polylines only. If we ever want axes/tooltips, reach for a
 * lib. Today the design plan calls the charts "quiet" so keep them dumb.
 */

export interface ChartExtent {
  min: number;
  max: number;
}

/** Widen a flat series so a horizontal line doesn't collapse into y=NaN. */
export function extent(values: readonly number[]): ChartExtent {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    // Fake a 1-unit band around the constant so the polyline sits mid-height.
    return { min: min - 0.5, max: max + 0.5 };
  }
  return { min, max };
}

/**
 * Map a series to an SVG polyline points string in a `width x height` box.
 * `padY` reserves a top/bottom gutter so line strokes don't clip.
 */
export function polylinePoints(
  values: readonly number[],
  width: number,
  height: number,
  padY = 2,
): string {
  if (values.length === 0) return '';
  const { min, max } = extent(values);
  const range = max - min || 1;
  const usable = Math.max(1, height - padY * 2);
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = values.length === 1 ? width / 2 : i * step;
      const y = padY + (1 - (v - min) / range) * usable;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

/** Direction of the last delta. Used to tone the sparkline. */
export function trendDirection(
  values: readonly number[],
): 'rising' | 'declining' | 'steady' {
  if (values.length < 2) return 'steady';
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const delta = last - first;
  const scale = Math.max(1, Math.abs(first));
  const rel = delta / scale;
  if (rel > 0.05) return 'rising';
  if (rel < -0.05) return 'declining';
  return 'steady';
}
