# ADR-0005: Auto Game-Log Ingestion from ESPN's Public API

**Status:** Accepted
**Date:** 2026-11-07
**Deciders:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)

## Context

Game logs in `data/game-logs.json` are typed in by hand. After every game night someone must look up each roster player's box-score line and append it before the box plot, distribution, Target Score Explorer, and advisor see the new game. That is the last manual step in the data pipeline, and it is also where the two Nov 6 anomalies slipped through (Sabonis's flagrant foul, Kyshawn's corrected assist count).

Sleeper cannot supply box scores: it has no per-game endpoint, and its weekly stats endpoint returns empty data for NBA. A separate box-score source is required.

## Decision

Ingest completed games from **ESPN's public API** (`site.api.espn.com`), via a hand-run Node CLI (`src/espn/ingest-cli.ts` / `src/espn/ingest.ts`, `npm run ingest:espn`) that **proposes** new `GameLog` entries for human review:

1. **Read-Only Default + Safe `--out <path>` Proposal File:** By default, `npm run ingest:espn -- --date YYYY-MM-DD` prints a human-readable report and the proposed `GameLog[]` JSON array to stdout. Passing `--out <path>` writes the proposed JSON array to `<path>`, refusing any path inside `data/` so committed data files are never auto-modified.
2. **Forward Ingestion + `--verify-existing` Audit Mode:** By default, existing `(sleeperId, date)` pairs in `data/game-logs.json` are skipped (`already logged`). Passing `--verify-existing` cross-checks already-committed logs on the requested date(s) against ESPN's box-score stats (`pts, reb, ast, stl, blk, tov, opponent`) and flags any discrepancy (`VERIFY_DIFF`).
3. **Header-Driven Stat Parsing, `minutes > 0` Threshold, and Team Code Normalization:** Parses ESPN `summary?event={id}` box-score tables by column header label (`MIN`, `PTS`, `REB`, `AST`, `STL`, `BLK`, `TO`/`TOV`), logs every `Final` game with `minutes > 0` (skipping only DNP / `0`-minute appearances), and normalizes ESPN team abbreviations (`GS -> GSW`, `NY -> NYK`, `NO -> NOP`, `SA -> SAS`, `UTAH -> UTA`, `WSH -> WAS`) to standard 3-letter NBA codes.
4. **Sleeper Reconciliation Check:** Enforces a formal pass/fail cross-check against Sleeper's `matchups/{leg}` `players_points[sleeperId]` when the player is unlocked in the leg and the proposed game is the latest game in the leg (raising a `RECONCILE` flag on mismatch, such as a technical or flagrant foul not split in ESPN's box score). Displays Sleeper's `players_points[sleeperId]` as informational reference alongside all other proposed logs.

The NBA CDN (`cdn.nba.com`) was tested and rejected: it returns 403 even with browser headers (Akamai bot protection from this environment).

## Rationale

- **ESPN is open:** no API key, no account, `access-control-allow-origin: *`. Verified live Nov 7: the scoreboard endpoint returns every game for a date with stable event IDs and Final/Scheduled status; the summary endpoint returns a full box score (minutes, points, FG/3PT/FT, rebounds, assists, turnovers, steals, blocks, offensive/defensive rebounds, fouls, plus/minus).
- **ESPN settles the Kyshawn question independently:** its Nov 6 box score lists Kyshawn George at 8 assists (`33/4/8, 1 stl, 2 blk, 2 tov`), matching Sleeper's `57.00` and the seed correction in commit `17ae2a54`.
- **Script, not runtime fetch:** the browser cannot write to the repo, and storing ingested logs in browser storage would fork the data away from git. Ingestion is a Node CLI, matching Phase 5b's read-only sync CLI.
- **Propose, don't apply:** the script outputs proposed entries and a reconciliation report; a human reviews and commits them. This preserves the repo's rule that data changes are reviewed, and keeps the Sleeper cross-check as a human decision point rather than an auto-correction.
- **Known gap, stated plainly:** ESPN's box score gives personal fouls total (`PF`) but does not split technicals and flagrants, so auto-ingested logs omit `tf` / `ff` (both default to `0`), exactly like the manual seed. The Sleeper reconciliation check catches any missed technical/flagrant foul (Sabonis's Nov 6 line computes `37.50` vs Sleeper's `35.50`, raising a `2.00` `RECONCILE` flag).

## Consequences

- One new mapping file (`data/espn-player-map.json`) linking Sleeper IDs to ESPN athlete IDs, seeded for the 15 roster players and enforced by `validateEspnPlayerMap` in `npm run validate`.
- Pure ingestion/reconciliation engine (`src/espn/ingest.ts`), CLI (`src/espn/ingest-cli.ts`), and fixture-based unit tests (`src/espn/ingest.test.ts`, never live network in tests).
- A follow-up design (6c) is needed for scheduled runs; Phase 6a/6b is hand-run only.
