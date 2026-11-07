# Gemini Blind Review — Phase 4 Design v0.1 (Box Plot & Time Windows)

**Date:** 2026-11-07
**Reviewer:** Gemini (Goldfish / Stateless Verifier)
**Reviewed PR:** #6 (`phase-4/design-v0.1`)

---

## 1. Math & Worked Example Verification

1. **Example 1 — Walker Kessler (`2441`), All Season (`N = 10`):**
   - Sorted totals in `data/game-logs.json`: `[12.75, 28.00, 32.75, 38.00, 42.75, 43.75, 45.25, 46.00, 48.25, 62.50]`.
   - `min = 12.75`, `max = 62.50`.
   - `Q1` (`p = 0.25, h = 2.25`): `32.75 + 0.25 * (38.00 - 32.75) = 34.0625` → `34.06` ✓
   - `median` (`p = 0.50, h = 4.50`): `(42.75 + 43.75) / 2 = 43.25` (matches `summarize().median`) ✓
   - `Q3` (`p = 0.75, h = 6.75`): `45.25 + 0.75 * (46.00 - 45.25) = 45.8125` → `45.81` ✓
   - `IQR`: `round2(45.81 - 34.06) = 11.75` ✓
2. **Example 2 — Walker Kessler (`2441`), `last-week` (`[2026-10-31, 2026-11-07]`, `N = 4`):**
   - Games in window: Nov 1 (`48.25`), Nov 2 (`43.75`), Nov 4 (`46.00`), Nov 6 (`38.00`).
   - Sorted totals: `[38.00, 43.75, 46.00, 48.25]`.
   - `min = 38.00`, `max = 48.25`.
   - `Q1` (`p = 0.25, h = 0.75`): `38.00 + 0.75 * (43.75 - 38.00) = 42.3125` → `42.31` ✓
   - `median` (`p = 0.50, h = 1.50`): `(43.75 + 46.00) / 2 = 44.875` → `44.88` ✓
   - `Q3` (`p = 0.75, h = 2.25`): `46.00 + 0.25 * (48.25 - 46.00) = 46.5625` → `46.56` ✓
   - `IQR`: `round2(46.56 - 42.31) = 4.25` ✓

---

## 2. Edge Cases Tightened Before Freeze

1. **Zero-span (`min === max`) SVG scale guard:**
   - When all games in a window have the same score (`min === max`, e.g., `N = 1` or tied scores such as Paul George's two `44.50` games on Oct 30 and Nov 1), `max - min === 0`.
   - **Rule added:** If `max === min`, pad the SVG domain by `±1.0` (`[min - 1, max + 1]`) instead of `0.05 * (max - min)` so SVG coordinate projection never divides by zero.
2. **Displayed `IQR` additive consistency:**
   - Compute `q1 = round2(q1Raw)` and `q3 = round2(q3Raw)` first, then `iqr = round2(q3 - q1)` so the displayed readout always satisfies `Q3 - Q1 === IQR`.
3. **Filtering raw `GameLog[]` vs `ScoredGame[]`:**
   - Filtering the player's `GameLog[]` by the active window before calling `analyzePlayer(sleeperId, windowedLogs)` ensures `summary`, `distribution`, and `isSpike` (top 3 positive games in the window) are all computed on the windowed set, while `filterGamesByWindow(games, window, asOf)` is also exported for `ScoredGame[]` callers.

---

## 3. Product Owner Interview (`/grill-me`) Decisions

1. **Window basis:** Trailing calendar days anchored at `PlayersFile.asOf` (`last-week` = 7d, `last-3-weeks` = 21d, `last-month` = 30d, `all` = All season).
2. **Window scope:** `PlayerDetail` only (filters summary cards, Box Plot, Target Score Explorer, and game list in `PlayerDetail`; `RosterView` remains full-season).
3. **Whiskers & small-N rule:** Min-to-max whiskers with every game plotted as a dot; draw the `Q1–Q3` box only when `N >= 3` (dots-only with explanatory note when `N` is 1–2).
4. **Banked score marker:** Show the vertical `Banked (B)` marker on the Box Plot when `B` falls within the plot scale `[min, max]`, and show a text note when `B` is outside `[min, max]`.
5. **Canonical design doc:** Fold Phase 4 directly into `docs/design/NETRICS-DESIGN.md` rather than maintaining a separate `NETRICS-DESIGN-PHASE4` file.
