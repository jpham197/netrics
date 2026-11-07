# ADR-0005: Auto Game-Log Ingestion from ESPN's Public API

**Status:** Proposed
**Date:** 2026-11-07
**Deciders:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)

## Context

Game logs in `data/game-logs.json` are typed in by hand. After every game night someone must look up each roster player's box-score line and append it before the box plot, distribution, Target Score Explorer, and advisor see the new game. That is the last manual step in the data pipeline, and it is also where the two Nov 6 anomalies slipped through (Sabonis's flagrant foul, Kyshawn's corrected assist count).

Sleeper cannot supply box scores: it has no per-game endpoint, and its weekly stats endpoint returns empty data for NBA. A separate box-score source is required.

## Decision

Ingest completed games from **ESPN's public API** (`site.api.espn.com`), via a hand-run Node script (`scripts/ingest-espn.ts`, `npm run ingest:espn`) that **proposes** new `GameLog` entries for human review. The script never writes data files and never commits. The NBA CDN (`cdn.nba.com`) was tested and rejected: it returns 403 even with browser headers (Akamai bot protection from this environment).

## Rationale

- **ESPN is open:** no API key, no account, `access-control-allow-origin: *`. Verified live Nov 7: the scoreboard endpoint returns every game for a date with stable event IDs and Final/Scheduled status; the summary endpoint returns a full box score (minutes, points, FG/3PT/FT, rebounds, assists, turnovers, steals, blocks, offensive/defensive rebounds, fouls, plus/minus).
- **ESPN settles the Kyshawn question independently:** its Nov 6 box score lists Kyshawn George at 8 assists (33/4/8, 1 stl, 2 blk), matching Sleeper's 57.00 and the seed correction in commit `17ae2a54`.
- **Script, not runtime fetch:** the browser cannot write to the repo, and storing ingested logs in browser storage would fork the data away from git. Ingestion is a script, the same reasoning as Phase 5b's read-only sync CLI.
- **Propose, don't apply:** the script prints proposed entries and a reconciliation report; a human applies them. This preserves the repo's rule that data changes are reviewed, and it keeps the Sleeper cross-check (§4 of the Phase 6 design) as a human decision point rather than an auto-correction.
- **Known gap, stated plainly:** ESPN's box score gives personal fouls total but does not split technicals and flagrants, so auto-ingested logs omit `tf` / `ff` (both default to `0`), exactly like the manual seed. The Sleeper reconciliation check is what catches a missed flagrant (Sabonis's Nov 6 line would compute `37.50` vs Sleeper's `35.50`).

## Consequences

- One new mapping file (`data/espn-player-map.json`) linking Sleeper IDs to ESPN athlete IDs, seeded by hand for the 15 roster players and validated by an extended validator.
- One new script plus fixture-based unit tests (never live network in tests).
- A follow-up design (6c) is needed for scheduled runs; Phase 6a is hand-run only.
