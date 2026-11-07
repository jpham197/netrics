# Netrics Phase 1 — Seed Coverage

Date: 2026-11-07. Spec: `docs/design/NETRICS-DESIGN-v1.0.md` §4 (every `GameLog` needs a full box-score line + `source`).

## What is seeded

- `data/players.json` — all 15 roster players, `asOf: "2026-11-07"`, `leagueId: "1358656481750171649"`.
- `data/game-logs.json` — **118 verified game logs across all 15 players** — every regular-season game played through Fri Nov 6, 2026:

| Player | Games | Ceiling |
|---|---|---|
| Cade Cunningham (`2267`) | 8 | `61.75` |
| Deni Avdija (`2181`) | 8 | `49.75` |
| Jeremiah Fears (`4750`) | 9 | `68.50` (Oct 29 vs SAC, 22/8/13, 4 blk) |
| Lauri Markkanen (`1752`) | 8 | `47.50` |
| Domantas Sabonis (`1739`) | 9 | `65.75` (triple-double Oct 23 vs POR, 27/19/10) |
| Kyshawn George (`2714`) | 9 | `55.50` |
| Walker Kessler (`2441`) | 10 | `62.50` |
| VJ Edgecombe (`4737`) | 9 | `47.25` |
| Jared McCain (`2713`) | 9 | `41.25` |
| Paul George (`1074`) | 8 | `60.75` |
| Saddiq Bey (`2131`) | 9 | `43.00` |
| Coby White (`1998`) | 3 | `14.25` |
| Jaime Jaquez Jr. (`2583`) | 9 | `36.25` |
| Nolan Traore (`4742`) | 8 | `34.00` |
| Keegan Murray (`2456`) | 2 | `18.00` |

Every seeded log has `expectedTotal` equal to its fantasy total computed from the box-score line, and `npm run validate` cross-checks it against the scoring engine. Per-game lines come from box scores (NBA.com / Basketball-Reference / Sportradar); Sleeper's `/stats/nba/regular/2026/<week>` endpoint returns weekly aggregates, not per-game lines, and must not be treated as game logs.

## Coverage notes

- **Keegan Murray played only 2 games** (Oct 21 @ LAC, Oct 23 vs POR) before going out with left ankle capsulitis; he missed the next 7 Kings games through Nov 6. His 2 logs are complete, not a gap in research.
- **Coby White debuted Nov 2** after a left calf strain and played only 3 games through Nov 6. His Nov 2 line includes `tf: 1` (technical foul, -2), the only technical/flagrant in the seed data; all other logs have `tf`/`ff` omitted (0).
- **No remaining gap through Nov 6:** every player now has all of their regular-season games played so far (Cade 8, Avdija 8, Fears 9, Markkanen 8, Kessler 10, McCain 9 — the six players whose early games were missing in the first pass are now complete). The dataset is still only through Nov 6, 2026, not a full season.
- **Sabonis Oct 23 vs POR (27/19/10, 65.75)** is the seed data's first real triple-double (DD+TD = +5) and is now directly tested in `src/scoring/scoring.test.ts`.

## Verification notes

- **Kessler `2026-10-23` (`62.50`):** NBA.com official box score (`0022600102`, LAC vs LAL) confirms `22 pts, 8 reb, 3 ast, 3 stl, 6 blk, 1 tov` in `34:54 MIN`.
- **Kessler `2026-11-01` (`48.25`):** NBC Sports gives `16/15/1, 1 stl, 3 blk`; Land of Basketball box-score table confirms `2 tov` (`50.25` with DD bonus minus `2.00` turnovers = `48.25`).
- **Avdija `2026-11-04` (`46.75`):** Fox Sports (`106649`) and Sports Rabbi confirm `21 pts, 7 reb, 12 ast, 0 stl, 0 blk, 3 tov` (`21 + 8.75 + 18 + 2 [DD] - 3 = 46.75`).
- **Kyshawn George `2026-11-06` @ ATL (`55.50`):** Sportradar's box-score table, NBA YouTube highlights, RotoWire, NBC Sports, and Bullets Forever all give `33 pts, 4 reb, 7 ast, 1 stl, 2 blk, 2 tov`. Basketball-Reference lists `8 ast` (which would be `57.00`); seeded as `7 ast` / `55.50` per the majority of sources, with the conflict recorded in the log's `source` string.
- **Traore `2026-10-25` vs IND:** the research pass first reported `32.00`, but the line `17/2/5, 1 stl, 2 blk, 2 tov` scores `34.00` (`17 + 2.50 + 7.50 + 3 + 6 - 2`); corrected to `34.00` before seeding. Season totals cross-checked against Basketball-Reference for all nine researched players.
- **Sabonis `2026-11-06` vs SAS (`37.50`):** `17/12/5, 4 tov` confirms the anchor from the user's chats.
- **Second pass (Nov 7):** Cade Oct 28 vs CHA was first reported as `53.75`, but the line `30/5/7, 2 stl, 0 blk, 1 tov` scores `51.75` (no double-double — only points reach 10); corrected before seeding. The three anchor distributions from the user's chats reproduced exactly: Fears' 8-game set (12.25, 9.50, 20.50, 20.50, 68.50, 36.75, 23.50, 33.50), Kessler's 9-game set (42.75, 62.50, 12.75, 28.00, 32.75, 45.25, 48.25, 43.75, 46.00), and Avdija's 7-game set (42.50, 43.75, 41.50, 48.75, 33.25, 37.25, 46.75). Markkanen was inactive Oct 28 vs SAS (no log) and played only 6:02 on Oct 26 vs MEM (2.00) — a real appearance, not a DNP.

## What is NOT in the seed data

- No weekly totals, no locks, no matchup data (deferred to Phase 3).
- No Nov 7 or later games (scope cut-off: Fri Nov 6, 2026).
