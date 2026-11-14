# ADR-0008: Multi-View UI Filters, Mobile Layout Polish, and Export/Share Views

**Status:** Accepted
**Date:** 2026-11-14
**Deciders:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)

## Context

Netrics currently renders full-roster, full-advisor, and full-matchup tables without client-side filtering, lacks narrow-viewport mobile layout refinements and printable styles, has no URL hash routing for deep-linking to a tab or player, and provides no way to copy or export view summaries or game-log CSVs.

## Decision

Add client-side filtering, responsive mobile layout polish, and export/share capabilities across `src/ui/` while strictly preserving all Netrics domain invariants:

1. **Multi-View UI Filters:**
   - **`RosterView`:** Client-side search by player name/team, position filter (`All`, `PG`, `SG`, `SF`, `PF`, `C`), and roster status filter (`All`, `Starter`, `Bench`, `Reserve`).
   - **`LockAdvisorView`:** Decision status filter (`All`, `Needs Decision`, `Locked`) so managers can focus on unlocked starters with pending lock/ride decisions.
   - **`MatchupView`:** `Hide locked-starter swaps` toggle on the Bench Swing table so infeasible swaps against already-locked starters can be hidden.
   - **`PlayerDetail`:** `Spikes only` toggle to filter the game-by-game distribution list strictly to `isSpike === true` (top 3 positive games in the active window per §5.4) while keeping summary cards and Box Plot anchored to the selected time window.
2. **Responsive Mobile Layout Polish (`src/ui/styles.css`, `src/ui/BoxPlot.tsx`):**
   - Add `@media` responsive breakpoints for narrow viewports (e.g., `max-width: 640px`), wrapping filter bars and Target Score Explorer target/chip rows cleanly without horizontal overflow.
   - Enforce `min-height: 40px` (40px+ touch targets) on interactive buttons, filter chips, and navigation controls on mobile.
   - Use a 2-column grid for summary cards on narrow viewports, and apply sticky first-column styling on wide horizontal-scrolling tables (`RosterView`, `LockAdvisorView`, `MatchupView`).
   - Improve `BoxPlot.tsx` mobile readability (responsive SVG sizing, legible tick/readout text, and clean wrapping of the `Min / Q1 / Median / Q3 / Max / IQR` readout).
3. **Export & Share Views (`src/ui/App.tsx`, `src/ui/exportShare.ts`, `src/ui/styles.css`):**
   - **URL Hash Routing (`App.tsx`):** Sync active tab and player drill-down with `window.location.hash` (`#roster`, `#advisor`, `#matchup`, `#player/<sleeperId>`), supporting direct load, browser back/forward (`hashchange`), and shareable links; an unknown `#player/<id>` hash falls back to `#roster`.
   - **Pure Export/Share Helpers (`src/ui/exportShare.ts`):**
     - `Copy Summary` clipboard buttons in `LockAdvisorView` (`formatLockAdvisorSummary`), `MatchupView` (`formatMatchupSummary`), and `PlayerDetail` (`formatPlayerSummary`), with transient `"Copied!"` feedback.
     - `Export CSV` downloads (RFC-4180 CSV) in `RosterView` (`buildRosterCsv`: exports the currently filtered rows with columns Player, Team, Pos, Status, Ceiling, Median, Floor, Last Game, GP) and `PlayerDetail` (`buildPlayerLogsCsv`: Date, Opponent, Total, Pts, Reb, Ast, Stl, Blk, Tov, TF, FF, Source).
   - **Print Styles (`@media print`):** Hide navigation chrome, filter controls, and action buttons while preserving high-contrast tables, summaries, and box plots for clean printing/PDF export.
4. **Non-Negotiable Domain Invariants:**
   - **Spikes, Not Averages:** `mean` may appear **only** in `PlayerDetail` (and `formatPlayerSummary`) labelled `Mean (ref only)` — never in `RosterView`, `LockAdvisorView`, `MatchupView`, or their summaries/CSVs.
   - **Pure Scoring Engine:** `fantasyPoints(g: GameLog)` in `src/scoring/` remains the sole place fantasy points are calculated.
   - **`expectedTotal` Isolation:** UI components and `exportShare.ts` must **never** read `GameLog.expectedTotal`.

## Rationale

- **Pure formatters in `exportShare.ts`:** Separating string/CSV generation from DOM clipboard/download calls allows full deterministic unit testing without browser mocks.
- **Hash routing without external router dependency:** `#roster`, `#advisor`, `#matchup`, and `#player/<sleeperId>` work identically on GitHub Pages static hosting without server-side rewrite rules.
- **Mobile-first ergonomics:** Fantasy lock-in decisions are frequently checked on phones right before tip-off; 40px+ touch targets, 2-col cards, sticky table columns, and `Needs Decision` / `Hide locked-starter swaps` filters directly reduce pre-tip friction.

## Consequences

- New pure module `src/ui/exportShare.ts` and unit tests (`src/ui/exportShare.test.ts`).
- Updated `App.tsx`, `RosterView.tsx`, `LockAdvisorView.tsx`, `MatchupView.tsx`, `PlayerDetail.tsx`, `BoxPlot.tsx`, and `styles.css`, with corresponding component tests in `src/ui/*.test.tsx`.
