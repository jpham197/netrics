# ADR-0007: Automatic Sleeper Roster/Week Sync & ESPN Multi-Day Backfill

**Status:** Accepted
**Date:** 2026-11-14
**Deciders:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)

## Context

Phase 5b introduced `npm run sync:sleeper` as a read-only diff report, and Phase 6c introduced `.github/workflows/ingest-nightly.yml` to open PRs for newly completed games. Two operational gaps remain:

1. **Manual roster and week maintenance:** When Roster 1 adds, drops, or moves players between starter/bench/reserve slots on Sleeper, or when the NBA fantasy week advances to a new `leg`, `data/players.json`, `data/weeks.json`, and `data/espn-player-map.json` still have to be edited by hand.
2. **Manual catch-up and disabled nightly schedule:** `.github/workflows/ingest-nightly.yml` currently lacks the `schedule` trigger, and `npm run ingest:espn` only accepts explicit `--date` flags or the 2-day `--window-eastern` window, requiring manual date-by-date runs after any missed day.

## Decision

Extend the Sleeper sync and ESPN ingestion pipelines with automated, PR-gated data updates while preserving all provenance and validation invariants:

1. **Sleeper Sync Apply Mode (`sync:sleeper --apply-to-data`, `src/sleeper/syncApply.ts`):**
   - Extend `npm run sync:sleeper` with `--apply-to-data` (and `--pr-meta-out <path>`) to apply Sleeper Roster 1 and `state/nba.leg` changes to `data/players.json`, `data/weeks.json`, and `data/espn-player-map.json`.
   - **Active Leg & New Leg Creation:** Updates `starters`, `bench`, `reserve`, `opponentRosterId`, `opponentName`, `opponentPoints`, `opponentAsOf`, and `opponentPlayers` on the active `WeekRecord`, and creates a new `WeekRecord` when `state/nba.leg` advances past the latest committed leg. `syncApply` may fetch `GET /v1/league/{id}/users` to resolve `opponentName` for new `WeekRecord` entries, and derives `startDate`/`endDate` for new legs using the Monday–Sunday weekly cadence from existing `weeks.json` / Sleeper `season_start_date`.
   - **ESPN Athlete ID Resolution:** Resolves `espnAthleteId` and `espnTeam` for newly added Sleeper players via ESPN's public NBA athlete/scoreboard APIs and adds them to `data/espn-player-map.json`.
   - **ESPN Schedule for `remainingGames`:** Fetches `WeekRecord.remainingGames` dates for each rostered player's team directly from ESPN's NBA scoreboard API across the week's `[startDate, endDate]` range (never guessed from memory), excluding dates where the NBA team's ESPN scoreboard game is already `Final` OR already present in `data/game-logs.json` for that player/team — ensuring all active teammates on the same NBA team share identical `remainingGames` as required by `validateWeeks`.
   - **`locks.json` Immutability & `players.json` FK Provenance:** `syncApply` must **never** modify `data/locks.json` or `data/game-logs.json`. Any dropped player who has existing entries in `data/game-logs.json` is retained in `data/players.json` (with `rosterStatus: "reserve"`) so `validateGameLogs` foreign-key checks and 1-to-1 `data/espn-player-map.json` coverage continue to pass; however, these retained dropped players are **not** added to `WeekRecord.starters`, `WeekRecord.bench`, or `WeekRecord.reserve` (since `validateWeeks` enforces `week.reserve.length <= 2` for Sleeper IR slots).
2. **ESPN Multi-Day Backfill & Catch-Up (`ingest:espn`):**
   - Extend `npm run ingest:espn` with `--from YYYY-MM-DD --to YYYY-MM-DD` (inclusive calendar-date range) and `--catch-up` (automatically spanning from the day after `PlayersFile.asOf` through `today` in `America/New_York`). `--catch-up` exits `0` as a no-op when `PlayersFile.asOf >= today`, and is mutually exclusive with `--date` / `--from`+`--to`.
   - All existing header-driven parsing, `minutes > 0` threshold, Sleeper reconciliation checks, and `applyIngestionProposal` rules from ADR-0005 and ADR-0006 apply uniformly across every date in the range.
3. **Nightly Cron Restoration & Sleeper Sync PR Workflow:**
   - Restore `schedule: - cron: "0 5 * * *"` in `.github/workflows/ingest-nightly.yml` (keeping `workflow_dispatch` for manual single-date or backfill runs).
   - Add `.github/workflows/sync-sleeper.yml` (scheduled + `workflow_dispatch`) to run `sync:sleeper --apply-to-data`, validate with `npm run validate && npm test && npm run build`, and open or update a pull request against `main` (`sync/sleeper-leg-<leg>` or `sync/sleeper-YYYY-MM-DD`). Neither workflow ever commits directly to `main` or auto-merges.

## Rationale

- **ESPN scoreboard is the single sourced schedule:** Sleeper has no NBA schedule endpoint; fetching `WeekRecord.remainingGames` from ESPN's scoreboard API guarantees no schedule dates are invented from memory.
- **Retaining dropped players with game logs preserves auditability:** Removing a player who has committed `GameLog` entries would break `validateGameLogs` and erase historical context; keeping them as `reserve` preserves FK integrity and `espn-player-map.json` alignment.
- **Immutability of `data/locks.json`:** Sleeper exposes no lock endpoint, and inferring locks from live `players_points` is forbidden; lock records remain human-curated.
- **Multi-day backfill + PR gate:** `--from`/`--to` and `--catch-up` make recovery from missed runs idempotent and single-command, while PR-only workflows ensure `npm run validate`, `npm test`, and `npm run build` always pass before data reaches `main`.

## Consequences

- New pure sync-apply module (`src/sleeper/syncApply.ts`) and tests (`src/sleeper/syncApply.test.ts`, fixture-only, no live network in tests).
- Extended `src/sleeper/sync-cli.ts` (`--apply-to-data`, `--pr-meta-out`) and `src/espn/ingest.ts` / `src/espn/ingest-cli.ts` (`--from`, `--to`, `--catch-up`).
- Restored cron schedule in `.github/workflows/ingest-nightly.yml` and new workflow `.github/workflows/sync-sleeper.yml`.
