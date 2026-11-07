# ADR-0003: Phase 4 — Box Plot and Time Windows in Player Detail

**Date:** 2026-11-07
**Status:** Accepted (reviewed in `docs/reviews/2026-11-07-gemini-phase4-review.md` and folded into `docs/design/NETRICS-DESIGN.md`)
**Context:** Player Detail shows a player's distribution as a game-by-game list and season-wide summary cards. The user asked for a visual summary of a player's historical stats (a five-number box plot) and a way to look at recent windows only (last week, last three weeks, last month, all season).

## Decision 1: Quartiles use linear interpolation

- Q1 / median / Q3 use the Excel `QUARTILE.INC` / NumPy default method: position `h = p * (N - 1)`, interpolate between the two nearest sorted values, and round each quartile with `round2` (`iqr = round2(q3 - q1)`).
- Rationale: it is the most widely implemented quartile definition, and its median is identical to the existing `summarize()` median for every `N`, so the box plot and the Median card never disagree.
- Consequence: quartiles are defined for any `N >= 1`; the display rule separately requires `N >= 3` to draw the box.

## Decision 2: Windows are trailing calendar days anchored at `PlayersFile.asOf`

- Last week = 7 days (`[asOf - 6d, asOf]`), Last 3 weeks = 21 days (`[asOf - 20d, asOf]`), Last month = 30 days (`[asOf - 29d, asOf]`), All season = no filter; bounds inclusive.
- Rationale: trailing days stay distinct as the season progresses. Leg-based windows would collapse early in the season (legs 1–3 cover Oct 20 – Nov 8, nearly the whole season at `asOf 2026-11-07`).
- Consequence: "last week" is the last 7 calendar days anchored at `PlayersFile.asOf`.

## Decision 3: The window filters the whole Player Detail view

- The player's logs are filtered to the selected window before `analyzePlayer()`, so summary cards, Target Score Explorer, game list, and box plot all show the same windowed games, with the window label visible in the Player Detail header.
- Rationale: one window for the whole view prevents the Median summary card and the box plot from showing different numbers.
- Consequence: switching windows resets the Target Score Explorer's initial target to the windowed last game's total.

## Decision 4: Whiskers extend to min and max; no outlier rule

- The box plot shows every game as a dot; no 1.5×IQR outlier treatment.
- Rationale: with 2–10 games per window the outlier rule would almost never fire, and hiding a real game outside the whiskers would mislead more than it clarifies.
- Consequence: the plot is a min-max box plot; the IQR is reported as a number in the text readout.

## Decision 5: Hand-drawn SVG, no chart library

- `src/ui/BoxPlot.tsx` renders plain SVG with the existing stylesheet, including a vertical `Banked (B)` marker when `B` is within `[min, max]` (or a text note when `B` falls outside the windowed range) and a `±1.0` fallback domain span when `min === max`.
- Rationale: the app has zero chart dependencies; a box plot with dots and one marker line is simple enough to draw directly, keeping the bundle and review surface small.

## Alternatives considered

- **Tukey hinges (median-of-halves) for quartiles**: rejected — gives a different median-adjacent definition on even `N` and would disagree with the existing `summarize()` median.
- **Leg-based windows**: rejected — collapses early in the season (see Decision 2).
- **Box plot on Roster View too**: rejected — Roster View keeps full-season stats and sorting.
- **1.5×IQR outlier whiskers**: rejected — hides real games on small samples (see Decision 4).
