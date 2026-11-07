# ADR-0004: Phase 5 — Live Sleeper Data (Runtime Matchup + Roster Sync Script)

**Date:** 2026-11-07
**Status:** Proposed (design v0.1 under Gemini blind review; freezes with `docs/design/NETRICS-DESIGN-PHASE5-v1.0.md`)
**Context:** All Netrics numbers come from hand-committed JSON. The week scoreboard goes stale after every game night, and roster changes (e.g., Jarace Walker dropped in Leg 3) are only noticed by hand. The Sleeper API is public and CORS-open, so the browser can read it directly — but Sleeper has no per-game box scores, no NBA schedules, and its weekly stats endpoint is empty for NBA.

## Decision 1: Live data is display-only, never an input

- The Matchup view may show live totals from `matchups/{leg}`; the advisor, locks, and `evaluateMatchup` keep using committed JSON and verified seed logs.
- Rationale: Sleeper's live `players_points` can lag lock actions for hours (Phase 3 §2.4) and is a week total, not a box score. Mixing it into advisor inputs would corrupt the verified-data chain.
- Consequence: Phase 5 changes what the scoreboard shows, not how any decision is computed.

## Decision 2: Two stages — runtime fetch (5a), then a report-only sync script (5b)

- 5a fetches the live matchup in the browser when the Matchup tab opens, with a manual Refresh button and a stored-snapshot fallback.
- 5b is a hand-run `npm run sync:sleeper` script that reports roster and week differences; it never writes data files and never commits.
- Rationale: the scoreboard is the only thing that needs to be live minute-to-minute; roster and week structure change slowly and deserve a reviewed commit.
- Consequence: no background jobs, no polling, no auto-commit in Phase 5.

## Decision 3: The weekly stats endpoint must not be used

- `GET /v1/stats/nba/regular/{week}` returns all 1,852 players with empty `{}` objects for weeks 1–3 (verified Nov 7). It is an NFL endpoint in practice.
- Rationale: empty data that looks like a valid response is the most dangerous kind — code that trusts it would silently show zeros.
- Consequence: any future use of Sleeper stats must re-verify the endpoint first; the design records the negative result so no agent re-discovers it the hard way.

## Decision 4: Per-game logs and schedules stay out of Phase 5

- Sleeper has no per-game box-score endpoint and no NBA schedule endpoint (schedules are NFL-only), so `game-logs.json` and `remainingGames` stay manual.
- Rationale: designing around an endpoint that does not exist would produce a script that cannot work; the gap is stated plainly instead.
- Consequence: automating game-log ingestion needs a different source (e.g., NBA stats API) as a separate future design.

## Alternatives considered

- **Sync-script-only (no runtime fetch):** rejected for the scoreboard — a committed snapshot goes stale every game night, which is the problem 5a solves; kept as open question 1.
- **Runtime fetch of everything (rosters, players file in the browser):** rejected — the 2.5 MB players file on every load is wasteful, and roster structure belongs in reviewed commits, not in a live read.
- **Auto-commit sync in CI:** rejected — violates the verified-data rule (no number enters the repo without a reviewed commit); kept out of Phase 5.
- **Polling the matchup endpoint on a timer:** rejected for v1 — one fetch on open plus a manual Refresh button; kept as open question 3.
