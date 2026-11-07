# ADR-0003: Phase 4 — Box Plot and Time Windows in Player Detail

**Date:** 2026-11-07
**Status:** Proposed (design v0.1 under Gemini blind review; freezes with `docs/design/NETRICS-DESIGN-PHASE4-v1.0.md`)
**Context:** Player Detail shows a player's distribution as a game-by-game list and season-wide summary cards. The user asked for a visual summary of a player's historical stats (a five-number box plot) and a way to look at recent windows only (last week, last three weeks, last month, all season).

## Decision 1: Quartiles use linear interpolation

- Q1 / median / Q3 use the Excel `QUARTILE.INC` / NumPy default method: position `h = p * (N - 1)`, interpolate between the two nearest sorted values.
- Rationale: it is the most widely implemented quartile definition, and its median is identical to the existing `summarize()` median for every `N`, so the box plot and the Median card can never disagree.
- Consequence: quartiles are defined for any `N >= 1`; the display rule (§4.2 of the design) separately requires `N >= 3` to draw the box.

## Decision 2: Windows are trailing calendar days anchored at `PlayersFile.asOf`

- Last week = 7 days, Last 3 weeks = 21 days, Last month = 30 days, All season = no filter; bounds inclusive.
- Rationale: trailing days stay distinct as the season progresses. Leg-based windows would collapse early in the season (legs 1–3 cover Oct 20 – Nov 8, nearly the whole season at `asOf 2026-11-07`).
- Consequence: "last week" is the last 7 calendar days, not the current Sleeper leg; the two differ by at most a day at the edges. Open question 1 in the design asks Gemini and the product owner to confirm this against the leg-based alternative.

## Decision 3: The window filters the whole Player Detail view

- The player's logs are filtered before `analyzePlayer()`, so summary cards, Target Score Explorer, game list, and box plot all show the same windowed games, with the window label visible.
- Rationale: the user asked for a window "on the stats being displayed" — one window for the whole view, not a box-plot-only filter that would let the Median card and the box disagree.
- Consequence: switching windows resets the Target Score Explorer's initial target to the windowed last game's total.

## Decision 4: Whiskers extend to min and max; no outlier rule

- The box plot shows every game as a dot; no 1.5×IQR outlier treatment.
- Rationale: with 2–10 games per window the outlier rule would almost never fire, and hiding a real game outside the whiskers would mislead more than it clarifies.
- Consequence: the plot is a min-max box plot; the IQR is reported as a number only.

## Decision 5: Hand-drawn SVG, no chart library

- `src/ui/BoxPlot.tsx` renders plain SVG with the existing stylesheet.
- Rationale: the app has zero chart dependencies; a box plot with dots and one marker line is simple enough to draw directly, and it keeps the bundle and the review surface small.

## Alternatives considered

- **Tukey hinges (median-of-halves) for quartiles**: rejected — gives a different median-adjacent definition on even `N` and would disagree with the existing `summarize()` median.
- **Leg-based windows**: not chosen — collapses early in the season (see Decision 2); kept as open question 1.
- **Box plot on Roster View too**: deferred — changes roster sorting semantics; Detail only for Phase 4.
- **1.5×IQR outlier whiskers**: rejected for v1 — hides real games on small samples (see Decision 4).
