// Netrics five-number summary — spec v1.0 §5.5 (FROZEN).
// Quartiles use linear interpolation (QUARTILE.INC / NumPy default) and
// round each quartile with round2 before computing iqr = round2(q3 - q1).

import { round2 } from "../scoring/index.js";

export interface FiveNumberSummary {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
}

function interpolatePercentile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  const h = p * (n - 1);
  const lo = Math.floor(h);
  const frac = h - lo;
  const xLo = sorted[lo] as number;
  const raw = lo + 1 < n ? xLo + frac * ((sorted[lo + 1] as number) - xLo) : xLo;
  return round2(raw);
}

/**
 * Compute the five-number summary (min, q1, median, q3, max) and IQR
 * from an array of fantasy totals. Returns null when totals.length === 0.
 */
export function fiveNumberSummary(totals: number[]): FiveNumberSummary | null {
  if (totals.length === 0) {
    return null;
  }
  const sorted = [...totals].sort((a, b) => a - b);
  const n = sorted.length;
  const min = round2(sorted[0] as number);
  const max = round2(sorted[n - 1] as number);
  const q1 = interpolatePercentile(sorted, 0.25);
  const median = interpolatePercentile(sorted, 0.5);
  const q3 = interpolatePercentile(sorted, 0.75);
  const iqr = round2(q3 - q1);

  return { n, min, q1, median, q3, max, iqr };
}
