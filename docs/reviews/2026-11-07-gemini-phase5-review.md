# Gemini Blind Review — Phase 5 Specification v0.1 (`phase-5/design-v0.1`, PR #7)

**Date:** 2026-11-07
**Reviewer:** Gemini (Goldfish / Stateless Verifier & Senior Software Engineer)
**Target:** `docs/design/NETRICS-DESIGN-PHASE5-v0.1.md` & `docs/decisions/0004-phase5-live-sleeper-data.md`

---

## 1. Blind Review Findings

1. **Missing Opponent Identifier in `fetchLiveMatchup` (§3):**
   - `GET /v1/league/{id}/matchups/{leg}` returns 12 roster objects (`roster_id: 1..12`), each with `matchup_id: 1..6`.
   - The draft signature `fetchLiveMatchup(leagueId: string, leg: number)` did not accept `opponentRosterId` (or `matchupId`) from `WeekRecord`, making it impossible to deterministically select the opponent entry from the 12-roster response without extra calls.
   - **Fix:** Update signature to `fetchLiveMatchup(leagueId: string, leg: number, opponentRosterId: number, matchupId?: number): Promise<LiveMatchup>` and verify `roster_id === opponentRosterId` (and `matchup_id === matchupId` when provided).
2. **Opponent Starter Name Resolution (§3):**
   - `matchups/{leg}` returns `starters: string[]` and `players_points: Record<string, number>` keyed by `sleeperId`, with no player names, teams, or positions. Meanwhile, `data/players.json` only stores Roster 1's players.
   - **Fix:** Add optional `sleeperId?: string` to `OpponentPlayerScore` in `src/data/types.ts` (validated as a non-empty string unique within `week.opponentPlayers`). In `MatchupView`, match live opponent starter `sleeperId`s against `week.opponentPlayers` to display `name` (`position · team`), falling back to `Player #<sleeperId>` when unknown.
3. **User Total & Override Precedence in `MatchupView` (§3):**
   - Sleeper's live `points` on Roster 1 can lag behind `locks.json` (Phase 3 §2.4). Replacing the primary `User Total` (`399.50`) with a lagging live Sleeper number would conflict with the starter breakdown table right below it.
   - **Fix:** Keep `matchup.userTotal` (computed from verified `locks.json` + `game-logs.json`) as the primary `Beltline Ballers` scoreboard value, and display `Sleeper live: <live.userPoints>` in the card subtitle when live data arrives. Use `live.opponentPoints` as the default `Opponent Total` (and `Margin = userTotal - effectiveOpponentPoints`) unless the user has manually edited the `Opponent score override` input.
4. **Canonical Design Consolidation:**
   - Per ADR-0001 and the Phase 4 consolidation (`f0576f3`), fold Phase 5 directly into `docs/design/NETRICS-DESIGN.md` and remove the standalone `docs/design/NETRICS-DESIGN-PHASE5-v0.1.md` draft.

---

## 2. Product Owner (`/grill-me`) Decisions

1. **Scoreboard & User/Opponent Totals (`MatchupView`, Stage 5a):**
   - Primary `Beltline Ballers` total stays grounded in verified Netrics locks/logs (`matchup.userTotal`), with `Sleeper live: XX.XX` shown as a secondary sub-label.
   - Live `opponentPoints` updates the default opponent score and margin when the fetch succeeds, while preserving manual `Opponent score override` and `Reset`.
2. **Opponent Starter Breakdown:**
   - Add optional `sleeperId?: string` to `OpponentPlayerScore` in `data/weeks.json` so `MatchupView` resolves opponent starter names without fetching the 2.5 MB `/v1/players/nba` file in the browser, falling back to `Player #<sleeperId>` when not in `week.opponentPlayers`.
3. **Refresh & Rate-Limit Guard (Stage 5a):**
   - Fetch once when `MatchupView` mounts (or when `week.leg` changes) and provide a manual `Refresh` button with a 15-second cooldown guard (`COOLDOWN_MS = 15_000`). No timer polling.
4. **Stage 5b (`npm run sync:sleeper`):**
   - Plain read-only diff report (`src/sleeper/syncReport.ts` + `src/sleeper/sync-cli.ts`) that never writes `data/*.json` and never commits; exits `0` when in sync and `1` when differences are detected.
