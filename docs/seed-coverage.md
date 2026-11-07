# Netrics Phase 1 — Seed Coverage

Date: 2026-11-07. Spec: `docs/design/NETRICS-DESIGN-v1.0.md` §4 (every `GameLog` needs a full box-score line + `source`).

## What is seeded

- `data/players.json` — all 15 roster players, `asOf: "2026-11-07"`, `leagueId: "1358656481750171649"`.
- `data/game-logs.json` — **76 verified game logs across all 15 players**, every regular-season game played through Fri Nov 6, 2026:

| Player | Games | Ceiling |
|---|---|---|
| Cade Cunningham (`2267`) | 1 | `61.75` |
| Deni Avdija (`2181`) | 2 | `49.75` |
| Jeremiah Fears (`4750`) | 1 | `41.75` |
| Lauri Markkanen (`1752`) | 2 | `47.50` |
| Domantas Sabonis (`1739`) | 9 | `65.75` (triple-double Oct 23 vs POR, 27/19/10) |
| Kyshawn George (`2714`) | 9 | `55.50` |
| Walker Kessler (`2441`) | 3 | `62.50` |
| VJ Edgecombe (`4737`) | 9 | `47.25` |
| Jared McCain (`2713`) | 1 | `41.25` |
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
- **Kessler, Fears, McCain, Cade** have only 1–3 logs because only their lines from v1.0 §3 / the user's chats were seeded in the first pass; their remaining early-season games are not yet in the data. That is the remaining gap, not a full-season dataset for any player.
- **Sabonis Oct 23 vs POR (27/19/10, 65.75)** is the seed data's first real triple-double (DD+TD = +5). The TD test's synthetic fixture in `src/scoring/scoring.test.ts` is still labelled synthetic.

## Verification notes

- **Kessler `2026-10-23` (`62.50`):** NBA.com official box score (`0022600102`, LAC vs LAL) confirms `22 pts, 8 reb, 3 ast, 3 stl, 6 blk, 1 tov` in `34:54 MIN`.
- **Kessler `2026-11-01` (`48.25`):** NBC Sports gives `16/15/1, 1 stl, 3 blk`; Land of Basketball box-score table confirms `2 tov` (`50.25` with DD bonus minus `2.00` turnovers = `48.25`).
- **Avdija `2026-11-04` (`46.75`):** Fox Sports (`106649`) and Sports Rabbi confirm `21 pts, 7 reb, 12 ast, 0 stl, 0 blk, 3 tov` (`21 + 8.75 + 18 + 2 [DD] - 3 = 46.75`).
- **Kyshawn George `2026-11-06` @ ATL (`55.50`):** Sportradar's box-score table, NBA YouTube highlights, RotoWire, NBC Sports, and Bullets Forever all give `33 pts, 4 reb, 7 ast, 1 stl, 2 blk, 2 tov`. Basketball-Reference lists `8 ast` (which would be `57.00`); seeded as `7 ast` / `55.50` per the majority of sources, with the conflict recorded in the log's `source` string.
- **Traore `2026-10-25` vs IND:** the research pass first reported `32.00`, but the line `17/2/5, 1 stl, 2 blk, 2 tov` scores `34.00` (`17 + 2.50 + 7.50 + 3 + 6 - 2`); corrected to `34.00` before seeding. Season totals cross-checked against Basketball-Reference for all nine researched players.
- **Sabonis `2026-11-06` vs SAS (`37.50`):** `17/12/5, 4 tov` confirms the anchor from the user's chats.

## What is NOT in the seed data

- No weekly totals, no locks, no matchup data (deferred to Phase 3).
- No Nov 7 or later games (scope cut-off: Fri Nov 6, 2026).
