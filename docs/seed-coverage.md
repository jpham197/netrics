# Netrics Phase 1 — Seed Coverage

Date: 2026-11-07. Spec: `docs/design/NETRICS-DESIGN-v1.0.md` §4 (every `GameLog` needs a full box-score line + `source`).

## What is seeded

- `data/players.json` — all 15 roster players, `asOf: "2026-11-07"`, `leagueId: "1358656481750171649"`.
- `data/game-logs.json` — **10 verified game logs across 6 players:**

| Player | Games | Dates & Scores |
|---|---|---|
| Cade Cunningham (`2267`) | 1 | `2026-11-02` vs CHA — `61.75` |
| Deni Avdija (`2181`) | 2 | `2026-11-04` @ PHX — `46.75`; `2026-11-06` vs LAL — `49.75` |
| Lauri Markkanen (`1752`) | 2 | `2026-11-04` @ NOP — `47.50`; `2026-11-06` @ DAL — `33.50` |
| Walker Kessler (`2441`) | 3 | `2026-10-23` vs LAC — `62.50`; `2026-11-01` vs TOR — `48.25`; `2026-11-04` @ SAC — `46.00` |
| Jeremiah Fears (`4750`) | 1 | `2026-11-06` vs MIN — `41.75` (`tov=2` verified in Sportradar/SportsFBI box score) |
| Jared McCain (`2713`) | 1 | `2026-11-06` @ MEM — `41.25` |

Every seeded log has `expectedTotal` equal to its verified Sleeper total, and `npm run validate` cross-checks it against the scoring engine.

## Coverage gap (by design — no guesses)

**9 players have no verified game logs yet:** Sabonis, Kyshawn George, VJ Edgecombe, Paul George, Saddiq Bey, Coby White, Jaime Jaquez Jr., Nolan Traore, Keegan Murray. No full-season logs for any player yet.

Reason: per-game lines require a box-score source (NBA.com / Basketball-Reference / Sportradar). Sleeper's `/stats/nba/regular/2026/<week>` endpoint returns weekly aggregates, not per-game lines, and must not be treated as game logs. Only lines verified in `v1.0` §3, in the user's chats, or in an official box score were seeded.

## Verification notes

- **Kessler `2026-10-23` (`62.50`):** NBA.com official box score (`0022600102`, LAC vs LAL) confirms `22 pts, 8 reb, 3 ast, 3 stl, 6 blk, 1 tov` in `34:54 MIN`.
- **Kessler `2026-11-01` (`48.25`):** NBC Sports gives `16/15/1, 1 stl, 3 blk`; Land of Basketball box-score table confirms `2 tov` (`50.25` with DD bonus minus `2.00` turnovers = `48.25`).
- **Avdija `2026-11-04` (`46.75`):** Fox Sports (`106649`) and Sports Rabbi confirm `21 pts, 7 reb, 12 ast, 0 stl, 0 blk, 3 tov` (`21 + 8.75 + 18 + 2 [DD] - 3 = 46.75`).

## What is NOT in the seed data

- No triple-double line in `data/game-logs.json` yet: no verified 2026–27 Cade Cunningham / Sabonis triple-double was found in this pass (closest real Cade line: `26/7/11` vs PHI, Nov 4 — not a TD). The TD test uses a clearly-labelled synthetic fixture in `src/scoring/scoring.test.ts`, not seed data.
- No weekly totals, no locks, no matchup data (deferred to Phase 3).
