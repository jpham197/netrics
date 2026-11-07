# Netrics Phase 1 — Seed Coverage

Date: 2026-11-07. Spec: v1.0 §4 (every GameLog needs a full box-score line + source).

## What is seeded

`data/players.json` — all 15 roster players, `asOf 2026-11-07`, league `1358656481750171649`.
`data/game-logs.json` — **10 verified game logs, 6 players:**

| Player | Games | Dates |
|---|---|---|
| Cade Cunningham (2267) | 1 | 2026-11-02 vs CHA — 61.75 |
| Deni Avdija (2181) | 2 | 2026-11-04 @ PHX — 46.75; 2026-11-06 vs LAL — 49.75 |
| Lauri Markkanen (1752) | 2 | 2026-11-04 @ NOP — 47.50; 2026-11-06 @ DAL — 33.50 |
| Walker Kessler (2441) | 3 | 2026-10-23 vs LAC — 62.50; 2026-11-01 vs TOR — 48.25; 2026-11-04 @ SAC — 46.00 |
| Jeremiah Fears (4750) | 1 | 2026-11-06 vs MIN — 41.75 (tov=2 verified in Sportradar/SportsFBI box score) |
| Jared McCain (2713) | 1 | 2026-11-06 @ MEM — 41.25 |

Every seeded log has `expectedTotal` equal to its verified Sleeper total, and
`npm run validate` cross-checks it against the engine.

## Coverage gap (by design — no guesses)

**9 players have no verified game logs yet:** Sabonis, Kyshawn George,
VJ Edgecombe, Paul George, Saddiq Bey, Coby White, Jaime Jaquez Jr.,
Nolan Traore, Keegan Murray. No full-season logs for any player yet.

Reason: per-game lines need a box-score source (NBA / Basketball-Reference /
Sportradar). Sleeper's `/stats/nba/regular/2026/<week>` endpoint returns
weekly aggregates, not per-game lines, and must not be treated as game logs.
Only lines verified in v1.0 §3, in the user's chats, or in a box score found
in this pass were seeded. The gap is filled in a later data pass, not by
inventing stats.

## Lower-confidence notes (2 logs)

- **Kessler 2026-10-23 (62.50):** box score gives 22/8/3, 3 stl, 6 blk;
  `tov=1` is inferred from the Sleeper total (63.50 before turnovers, no
  tf/ff reported). Flagged in the log's `source` string.
- **Kessler 2026-11-01 (48.25):** NBC Sports gives 16/15/1, 1 stl, 3 blk.
  With the double-double (+2) that line scores 50.25 before turnovers, so
  the Sleeper total 48.25 forces `tov=2` — confirmed by the turnover column
  in the landofbasketball box-score table for that game. The seed log now
  has `tov: 2` (corrected during testing, after the engine flagged 50.25).

## What is NOT in the seed data

- No triple-double line: no verified 2026-27 Cade Cunningham / Sabonis
  triple-double was found in this pass (closest real Cade line: 26/7/11
  vs PHI, Nov 4 — not a TD). The TD test uses a clearly-labelled
  synthetic fixture in `src/scoring/scoring.test.ts`, not seed data.
- No weekly totals, no locks, no matchup data (deferred, Phase 3).
