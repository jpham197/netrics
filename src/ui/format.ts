// Number formatting for the UI. All fantasy totals are shown to 2 decimals.

/** "62.50", "46.00", "2.00". Null (no games) renders as an em dash. */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(2);
}

/** "+16.50" / "-3.00" / "+0.00" for upside/downside displays. */
export function fmtSigned(n: number, sign: "+" | "-"): string {
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

/** "22%" from a 0..1 beat-rate. */
export function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** "11-04" from a YYYY-MM-DD date. */
export function fmtShortDate(date: string): string {
  return date.slice(5);
}
