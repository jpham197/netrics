// Netrics time-window filtering — spec v1.0 §5.6 (FROZEN).
// Trailing calendar-day ranges anchored at PlayersFile.asOf (inclusive on
// both ends: startDate <= date <= asOf), computed in UTC date arithmetic.

import type { GameLog } from "../data/types.js";
import type { ScoredGame } from "./index.js";

export type TimeWindow = "last-week" | "last-3-weeks" | "last-month" | "all";

export const TIME_WINDOWS: readonly { id: TimeWindow; label: string; days: number | null }[] = [
  { id: "last-week", label: "Last week", days: 7 },
  { id: "last-3-weeks", label: "Last 3 weeks", days: 21 },
  { id: "last-month", label: "Last month", days: 30 },
  { id: "all", label: "All season", days: null },
] as const;

/**
 * Compute the inclusive start date YYYY-MM-DD for a trailing window of `days`
 * calendar days ending on `asOf` (i.e. `asOf` minus `days - 1` calendar days)
 * using UTC date arithmetic.
 */
export function windowStartDate(asOf: string, days: number): string {
  const parts = asOf.split("-").map(Number);
  const year = parts[0] as number;
  const month = parts[1] as number;
  const day = parts[2] as number;
  const d = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  return d.toISOString().slice(0, 10);
}

function windowDays(window: TimeWindow): number | null {
  const found = TIME_WINDOWS.find((w) => w.id === window);
  return found ? found.days : null;
}

/**
 * Filter raw GameLog entries to the selected time window anchored at `asOf`.
 * When `window === "all"`, returns the input array unchanged.
 */
export function filterLogsByWindow(logs: GameLog[], window: TimeWindow, asOf: string): GameLog[] {
  const days = windowDays(window);
  if (days === null) {
    return logs;
  }
  const start = windowStartDate(asOf, days);
  return logs.filter((log) => log.date >= start && log.date <= asOf);
}

/**
 * Filter ScoredGame entries to the selected time window anchored at `asOf`.
 * When `window === "all"`, returns the input array unchanged.
 */
export function filterGamesByWindow(
  games: ScoredGame[],
  window: TimeWindow,
  asOf: string,
): ScoredGame[] {
  const days = windowDays(window);
  if (days === null) {
    return games;
  }
  const start = windowStartDate(asOf, days);
  return games.filter((g) => g.log.date >= start && g.log.date <= asOf);
}
