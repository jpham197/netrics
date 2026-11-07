# Netrics — Phase 4 Specification v0.1 (DRAFT)

**Status:** DRAFT — For Gemini blind review (same process as Phase 0 and Phase 3: design v0.1 → Gemini review → revisions → freeze → build).
**Date:** 2026-11-07
**Authors:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)
**Repo:** `jpham197/netrics` (Vite + React + TypeScript, GitHub Pages via GitHub Actions)
**Depends on:** `docs/design/NETRICS-DESIGN.md` (FROZEN) — scoring engine, analytics, advisor, data model, and UI in v1 + Phase 3 are unchanged by this doc. Phase 4 adds one pure analytics module (`src/analytics/boxplot.ts`), one window module (`src/analytics/windows.ts`), one SVG view (`src/ui/BoxPlot.tsx`), and a time-window selector in Player Detail. No new data files, no schema changes, no validator changes.

---

## 1. Problem & Phase 4 Scope

Player Detail currently shows a player's distribution as a sorted game-by-game list with bars scaled to the ceiling, plus summary cards (Ceiling / Median / Floor / Last Game / GP) and the Target Score Explorer. Two gaps:

1. **No shape of the distribution.** A list of bars shows each game, but not at a glance how the scores spread: where the middle half sits, how far the typical game is from the ceiling, whether the distribution is bunched or stretched.
2. **No time window.** Every stat is computed over the whole season. The user cannot ask "how has he played lately" — last week, last three weeks, last month — without the early-season games diluting the picture.

Phase 4 answers both, in Player Detail only:

1. **Box plot (box-and-whisker plot) of fantasy totals.** One horizontal box per player per window, showing the five-number summary: minimum, first quartile (Q1), median, third quartile (Q3), maximum. Every game in the window is also plotted as a dot on the same scale, so the box never hides the raw games.
2. **Time-window selector.** Four windows — Last week, Last 3 weeks, Last month, All season — that filter every stat in Player Detail (box plot, summary cards, Target Score Explorer, game list) to the games inside the window.

### Out of scope for Phase 4
- Roster View keeps season-wide numbers; no window selector there.
- No new data files, no changes to `players.json` / `game-logs.json` / `weeks.json` / `locks.json`, no validator changes.
- No chart library; the plot is hand-drawn SVG (zero new dependencies).
- No opponent box plots, no cross-player comparison view.

---

## 2. Five-Number Summary — Definitions

Given a player's windowed fantasy totals, sorted ascending `x[0..N-1]`:

- `min = x[0]`, `max = x[N-1]`.
- Quartiles use **linear interpolation** (the Excel `QUARTILE.INC` / NumPy default method). For percentile `p` in `{0.25, 0.5, 0.75}`: position `h = p * (N - 1)`; let `lo = floor(h)`, `frac = h - lo`; `Q = x[lo] + frac * (x[lo+1] - x[lo])` (if `lo + 1 < N`, else `x[lo]`).
- `median` is the `p = 0.5` case of the same formula. It is identical to the existing `summarize()` median for every `N` (odd `N`: middle value; even `N`: average of the two middle values), so the box plot's median line and the Median summary card always agree.
- `IQR = Q3 - Q1`, shown as a number in the readout, not as a separate visual element.
- **Whiskers extend to min and max.** No 1.5×IQR outlier rule in v1: with 2–10 games per window, the outlier rule would almost never fire and would hide real games. Every game is a dot on the plot regardless.

All five numbers are `round2` for display, computed from unrounded totals.

## 3. Time Windows — Definitions

Windows are trailing calendar-day ranges anchored at `PlayersFile.asOf` (currently `2026-11-07`), inclusive on both ends. A game is in the window when `startDate <= game.date <= asOf`.

| Window | Label | Range |
|---|---|---|
| `last-week` | Last week | `[asOf - 6 days, asOf]` (7 calendar days) |
| `last-3-weeks` | Last 3 weeks | `[asOf - 20 days, asOf]` (21 calendar days) |
| `last-month` | Last month | `[asOf - 29 days, asOf]` (30 calendar days) |
| `all` | All season | All logged games (no date filter) |

- Default window: **All season** (current behavior unchanged on first open).
- Early-season note: the season started `2026-10-20`, so at `asOf 2026-11-07` the Last 3 weeks window (`Oct 18 – Nov 7`) and the Last month window (`Oct 9 – Nov 7`) both contain every logged game, identical to All season. They diverge as the season progresses. This is expected, not a bug.
- The window filters the **whole Player Detail view**: the player's logs are filtered before `analyzePlayer()`, so summary cards, Target Score Explorer (chips, beat-rate, upside/downside), game list, and box plot all show the same windowed games. The selected window label is visible next to the player name, so a windowed Median can never be mistaken for a season Median.

## 4. Math Contract (`src/analytics/boxplot.ts`, `src/analytics/windows.ts`)

Pure TypeScript, zero UI or network dependencies. Never reads `GameLog.expectedTotal`.

```ts
export interface FiveNumberSummary {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number; // round2(q3 - q1)
}

export function fiveNumberSummary(totals: number[]): FiveNumberSummary | null;
// null when totals.length === 0. Defined for any N >= 1 by the §2 interpolation formula.

export type TimeWindow = "last-week" | "last-3-weeks" | "last-month" | "all";
export const TIME_WINDOWS: { id: TimeWindow; label: string; days: number | null }[];
// days: 7, 21, 30, null (all). Start date = asOf minus (days - 1) days, computed in UTC date arithmetic on YYYY-MM-DD strings.

export function filterGamesByWindow(games: ScoredGame[], window: TimeWindow, asOf: string): ScoredGame[];
// "all" returns games unchanged. Otherwise keeps games with startDate <= log.date <= asOf.
```

### 4.1 Worked Examples (Required Unit Tests in Phase 4b)

1. **Kessler (`2441`), full season (N = 10):**
   - Sorted totals: `12.75, 28.00, 32.75, 38.00, 42.75, 43.75, 45.25, 46.00, 48.25, 62.50`.
   - `min = 12.75`, `max = 62.50`.
   - Q1: `h = 0.25 * 9 = 2.25` → `32.75 + 0.25 * (38.00 - 32.75) = 34.06`.
   - Median: `h = 0.5 * 9 = 4.5` → `(42.75 + 43.75) / 2 = 43.25` (matches existing `summarize()` median).
   - Q3: `h = 0.75 * 9 = 6.75` → `45.25 + 0.75 * (46.00 - 45.25) = 45.81`.
   - `IQR = 45.81 - 34.06 = 11.75`.
2. **Kessler (`2441`), Last week window, `asOf 2026-11-07` (N = 4):**
   - Window `[2026-10-31, 2026-11-07]` keeps Nov 1 `48.25`, Nov 2 `43.75`, Nov 4 `46.00`, Nov 6 `38.00`.
   - Sorted: `38.00, 43.75, 46.00, 48.25`.
   - `min = 38.00`, `max = 48.25`.
   - Q1: `h = 0.25 * 3 = 0.75` → `38.00 + 0.75 * (43.75 - 38.00) = 42.31`.
   - Median: `h = 0.5 * 3 = 1.5` → `(43.75 + 46.00) / 2 = 44.88`.
   - Q3: `h = 0.75 * 3 = 2.25` → `46.00 + 0.25 * (48.25 - 46.00) = 46.56`.
   - `IQR = 46.56 - 42.31 = 4.25`.
3. **Small-N behavior (unit tests):** `N = 3` totals `[10, 20, 30]` → `min 10, Q1 15.00, median 20.00, Q3 25.00, max 30`. `N = 1` → all five numbers equal that game's total. `N = 0` → `null`.

### 4.2 Small-N Display Rule

The pure function is defined for any `N >= 1`, but the box is only drawn when `N >= 3`. When a window holds 1–2 games, the plot area shows the game dots on the scale plus the note "Not enough games for a box plot — showing individual games." When `N = 0`, the existing "No games logged yet" empty state is shown. The `N >= 3` threshold is a display rule, not a math rule, and is a reviewable decision (§7, question 2).

## 5. UI (`src/ui/BoxPlot.tsx`, `src/ui/PlayerDetail.tsx`)

- **Window selector:** four chips (Last week / Last 3 weeks / Last month / All season) above the summary cards in Player Detail, default All season. Switching windows re-runs the whole view from the filtered games; the Target Score Explorer's initial target resets to the windowed last game's total (same rule as today, applied to the window).
- **Box plot section** (new, between the summary cards and the Target Score Explorer):
  - Horizontal SVG box plot: a scale from the windowed floor to the windowed ceiling (padded by 5% on each side so dots at the extremes stay visible), a box from Q1 to Q3, a median line inside the box, whisker lines from the box to min and max, and one dot per game in the window (dots for spike games keep their spike styling).
  - **Banked-score marker:** when the player has a banked score `B` in the active leg (`bankedScore` prop, already passed to Player Detail), a vertical marker line at `B` labelled `Banked (B)`, so the user sees where the banked score sits inside the recent distribution. The marker is drawn only when `B` falls inside the plot's scale; if `B` is outside the windowed range, the label notes that instead of drawing a misleading line.
  - **Five-number readout** under the plot as text (`Min / Q1 / Median / Q3 / Max / IQR`, each `round2`), which is also the accessible equivalent of the graphic.
  - No new dependencies; the plot is plain SVG with the existing stylesheet.
- **Roster View:** unchanged (season-wide numbers, no window selector).

## 6. What Stays Unchanged

- Scoring engine, `analyzePlayer` / `summarize` / `evaluateTarget`, advisor, matchup, bench swing: untouched.
- `mean` stays labelled `Mean (ref only)` and is never a decision target; the box plot shows median and quartiles, never a mean line.
- No data files change; no validator changes. The window anchor is the existing `PlayersFile.asOf`.

## 7. Phases

- **4a design (this PR):** this doc + ADR-0003, for Gemini blind review.
- **Freeze:** resolve the open questions below, then mark v1.0 FROZEN.
- **4b build:** `src/analytics/boxplot.ts` + `src/analytics/windows.ts` with unit tests (including the §4.1 worked examples and window-boundary tests), `src/ui/BoxPlot.tsx` with tests, Player Detail window selector + windowed view, then a PR for Gemini review. CI gates unchanged (`npm run validate && npm test && npm run build`).

## 8. Open Questions for Gemini + Product Owner

1. **Window basis — trailing days (recommended) vs Sleeper legs?** Trailing days are simple and stay distinct as the season goes on. Leg-based windows would make "Last week" the current leg and "Last 3 weeks" legs 1–3, which at this point in the season is nearly the whole season, so the windows would barely differ until December. Is trailing days acceptable, or should the windows follow legs?
2. **Box threshold — draw the box only at `N >= 3`?** Below that the quartiles are still defined by interpolation but the box is more decoration than information. Acceptable, or draw the box for any `N >= 1`?
3. **Whiskers — min/max (recommended) vs 1.5×IQR outlier rule?** The outlier rule would hide games as dots-outside-whiskers on small samples. Keep min/max whiskers?
4. **Banked marker — keep it?** It ties the box plot to the lock decision, but it adds a second concept to a simple plot. Keep, or keep the box plot purely historical?
5. **Roster View — window selector there too, or Detail only?** Detail only is the draft scope; a roster-wide window would change sorting and is a bigger change.
