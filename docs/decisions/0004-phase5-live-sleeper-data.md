# ADR-0004: Phase 5 — Live Sleeper Data (Runtime Matchup + Roster Sync Script)

**Date:** 2026-11-07
**Status:** Accepted (frozen in `docs/design/NETRICS-DESIGN.md` §8; reviewed in `docs/reviews/2026-11-07-gemini-phase5-review.md`)
**Context:** All Netrics numbers come from hand-committed JSON. The week scoreboard goes stale after every game night, and roster changes (e.g., Jarace Walker dropped in Leg 3) are only noticed by hand. The Sleeper API is public and CORS-open, so the browser can read it directly — but Sleeper has no per-game box scores, no NBA schedules, and its weekly stats endpoint is empty for NBA.

## Decision 1: Live data is display-only, never an advisor/lock input

- `MatchupView` fetches live totals from `GET /v1/league/{id}/matchups/{leg}`:
  - Primary `Beltline Ballers` total (`matchup.userTotal`) stays grounded in verified Netrics `locks.json` + `game-logs.json`, with `Sleeper live: <userPoints>` displayed as a secondary sub-label on the user card.
  - `live.opponentPoints` updates the default opponent score and `margin` (`userTotal - effectiveOpponentPoints`) when the fetch succeeds, while preserving manual `Opponent score override` and fallback to `WeekRecord.opponentPoints` when offline.
  - Live opponent starter points (`live.opponentStarters`) resolve player names via optional `OpponentPlayerScore.sleeperId` in `data/weeks.json`, falling back to `Player #<sleeperId>`.
- Rationale: Sleeper's live `players_points` can lag lock actions for hours (Phase 3 §2.4) and is a week total, not a box score. Keeping `userTotal`, locks, and advisor inputs on verified seed data preserves the verified-data chain while giving a live opponent scoreboard.

## Decision 2: Two stages — runtime fetch with 15s cooldown (5a), plus a report-only sync script (5b)

- **5a (`src/sleeper/liveMatchup.ts` + `src/ui/MatchupView.tsx`):** Fetches the live matchup once when the Matchup tab opens (or `week.leg` changes), with a manual `Refresh` button guarded by a 15-second cooldown (`COOLDOWN_MS = 15_000`) and automatic fallback to the stored `weeks.json` snapshot. No timer polling.
- **5b (`src/sleeper/syncReport.ts` + `src/sleeper/sync-cli.ts`, `npm run sync:sleeper`):** Hand-run CLI script that compares live Sleeper state (`state/nba`, `rosters`, `transactions/{leg}`, `matchups/{leg}`, `players/nba`) against `data/players.json` and `data/weeks.json`, prints a plain read-only diff report, and exits `0` when in sync or `1` when differences are found. It never writes `data/*.json` and never commits.

## Decision 3: The weekly stats endpoint must not be used

- `GET /v1/stats/nba/regular/{week}` returns all 1,852 players with empty `{}` objects for weeks 1–3 (verified Nov 7). It is an NFL endpoint in practice and must not be called.

## Decision 4: Per-game logs and schedules stay out of Phase 5

- Sleeper has no per-game box-score endpoint and no NBA schedule endpoint (schedules are NFL-only), so `game-logs.json` and `remainingGames` remain manually curated and validated by `npm run validate`.

## Alternatives considered

- **Replacing primary `User Total` with Sleeper's live `userPoints`:** rejected because Sleeper's live `points` can lag `locks.json`, which would make the scoreboard contradict the verified starter breakdown table below it.
- **Fetching the 2.5 MB `/v1/players/nba` dictionary in the browser:** rejected as wasteful for resolving 9 opponent starter names; resolved via optional `sleeperId` on `week.opponentPlayers` with `Player #<sleeperId>` fallback.
- **Sync-script-only (no runtime fetch):** rejected for the opponent scoreboard because committed snapshots go stale every game night.
- **Auto-commit sync in CI or timer polling:** rejected to preserve the verified-data rule and avoid unnecessary background traffic.
