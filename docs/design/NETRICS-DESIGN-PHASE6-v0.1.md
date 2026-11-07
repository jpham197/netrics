# Netrics — Phase 6 Specification v0.1 (DRAFT)

**Status:** DRAFT — For Gemini blind review (same process as Phases 0, 3, 4, 5: design v0.1 → Gemini review → revisions → freeze → build).
**Date:** 2026-11-07
**Authors:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)
**Repo:** `jpham197/netrics` (Vite + React + TypeScript, GitHub Pages via GitHub Actions)
**Depends on:** `docs/design/NETRICS-DESIGN.md` (FROZEN) — scoring engine, analytics, advisor, data model, and UI in v1 + Phases 3–5 are unchanged by this doc. Phase 6 adds one ingestion script (`scripts/ingest-espn.ts`, `npm run ingest:espn`), one mapping file (`data/espn-player-map.json`), and a validator extension for the mapping file. No scoring, analytics, advisor, UI, or live-fetch changes.

---

## 1. Problem & Phase 6 Scope

Phase 5 made the week scoreboard live, but game logs are still typed in by hand. After every game night someone must look up each roster player's box-score line and append it to `data/game-logs.json` before the box plot, distribution, Target Score Explorer, and advisor see the new game. That is the last manual step in the data pipeline, and it is also where the two Nov 6 anomalies slipped through (Sabonis's flagrant foul, Kyshawn's corrected assist count).

Phase 6 automates the mechanical part: a script that fetches completed games from ESPN's public API, extracts the roster players' stat lines, and proposes new `GameLog` entries — for a human to review and commit. It never writes data files itself and never commits.

### What Phase 6 is not
- Not a runtime/browser feature: the browser cannot write to the repo, and storing ingested logs in browser storage would fork the data away from git. Ingestion is a script, like Phase 5b.
- Not a schedule: Phase 6a is a hand-run script. Scheduled runs (e.g., a nightly job that opens a PR) are a separate follow-up slice (6b), not in this design.
- Not a new box-score source for the UI: the UI keeps reading committed `game-logs.json`. The script only proposes entries.

## 2. Verified Source Inventory (checked live Nov 7)

| Source | Works? | Result |
|---|---|---|
| ESPN scoreboard `site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD` | Yes | All games for a date with stable event IDs, teams, status (Final / Scheduled). Nov 6: 9 games, all Final. Nov 7: 7 games, all Scheduled, including `401909941` Thunder vs Wizards (McCain's game, 8 PM ET). No key, `access-control-allow-origin: *`. |
| ESPN summary `.../nba/summary?event={id}` | Yes | Full box score per game (~440 KB per game, includes plays/news/odds). Player lines carry minutes, points, FG, 3PT, FT, rebounds, assists, turnovers, steals, blocks, offensive/defensive rebounds, fouls (personal total), plus/minus. No key, CORS `*`. |
| NBA CDN `cdn.nba.com/static/json/liveData/boxscore/boxscore_{gameId}.json` | No — 403 | Blocked even with browser User-Agent + Referer (Akamai bot protection from this environment). Recorded so no agent retries it. |
| Sleeper API | Yes, but no box scores | Confirmed in Phase 5: no per-game endpoint; weekly stats empty for NBA. Sleeper is used only for the §4 reconciliation check. |

### Kyshawn assist count — settled by ESPN
ESPN's Nov 6 box score for WAS @ ATL lists Kyshawn George as `33 pts, 4 reb, 8 ast, 1 stl, 2 blk, 2 tov` — **8 assists**, matching Sleeper's `57.00` and the seed correction in commit `17ae2a54`. The 7-assist readings were the live box scores before a post-game correction. ESPN is an independent confirmation that the seed is now right.

### Field coverage gap: technical / flagrant fouls
ESPN's box score gives `fouls` (personal fouls total) but does **not** split technicals and flagrants. So auto-ingested logs omit `tf` / `ff` (both default to `0`), exactly like the manual seed, which had the same limitation (Basketball-Reference does not report technicals either). The §4 reconciliation check is what catches a missed flagrant: Sabonis's Nov 6 line would have computed `37.50` against Sleeper's `35.50`, a `2.00` gap flagged for human review.

## 3. Ingestion Flow (`scripts/ingest-espn.ts`)

```
npm run ingest:espn -- --date 2026-11-07 [--date 2026-11-08]
```

1. **Discover games:** for each requested date, fetch the ESPN scoreboard; keep games with `status.type.description === "Final"` involving a roster team (roster teams from `players.json`, matched by ESPN team abbreviation).
2. **Fetch box scores:** for each kept game, fetch the ESPN summary; find each roster player's athlete entry by the mapping file (§5).
3. **Build proposed logs:** for each roster player who played (minutes > 0), build a `GameLog` — `sleeperId`, `date` (game date, America/New_York), `opponent` (`"OPP"` when the player's team is home, `"@OPP"` when away), `pts`, `reb`, `ast`, `stl`, `blk`, `tov`, `expectedTotal = fantasyPoints(log).total`, `source` = `ESPN box score {eventId} {date} {away} @ {home} ({pts}/{reb}/{ast}, {stl} stl, {blk} blk, {tov} tov)`. `tf` / `ff` omitted. Skip players with `0` minutes (DNP) and games already present in `game-logs.json` (unique `(sleeperId, date)` check).
4. **Reconcile (§4):** for each proposed log, run the Sleeper cross-check where it applies; collect flags.
5. **Output (stdout, never a file write):** a report listing proposed logs, skipped games (with reasons: already logged, DNP, not Final), and reconciliation flags; then the proposed entries as a JSON array the operator can review. Exit `0` when every proposed log reconciles, `1` when any flag is raised or any fetch fails.

## 4. Sleeper Reconciliation Check

For each proposed log, compare its computed total against Sleeper's live `players_points` — **only when the comparison is valid**:

- The player has **no `LockRecord`** for the leg containing the game date (a locked player's Sleeper total is the locked score, not the latest game).
- The proposed game is the player's **most recent completed game in the leg** (by date, among seed logs plus the proposed log). Then Sleeper's `players_points` should equal `fantasyPoints(proposed log).total`.
- If both hold and the values differ, flag it: `RECONCILE: {player} {date} computed {total} vs Sleeper {sleeperTotal} (diff {d})`. The script never auto-corrects; the human decides, exactly as with the Kyshawn case.
- When the conditions do not hold (locked, or an earlier game in the leg), the check is skipped and the report says so. A skipped check is not a pass and not a fail.

## 5. Player Mapping (`data/espn-player-map.json`)

ESPN athletes have their own numeric IDs; the repo keys players by Sleeper ID. Matching by name at runtime is fragile (name variants, trades), so the mapping is an explicit committed file:

```ts
export interface EspnPlayerMapEntry {
  sleeperId: string;     // Foreign key -> Player.sleeperId
  espnAthleteId: string; // ESPN athlete id, e.g. "4684808"
  name: string;          // Display name, for human review
  espnTeam: string;      // ESPN 3-letter team code, e.g. "WAS"
}
export interface EspnPlayerMapFile {
  leagueId: string;
  players: EspnPlayerMapEntry[];
}
```

- One entry per rostered player (15 to start). `espnTeam` is recorded from ESPN, not from `players.json`, because Sleeper's team field has known quirks (Kessler listed as `LAL` in Sleeper's file; ESPN lists his real team).
- Validator extension: every `sleeperId` in `players.json` must have exactly one mapping entry; every mapping entry's `sleeperId` must exist in `players.json`; no duplicate `espnAthleteId`.
- The mapping file is seeded by hand once (15 players, verified against ESPN athlete pages) and updated only when the roster changes.

## 6. What Stays Unchanged

- Scoring engine, analytics, advisor, matchup, bench swing, UI, live matchup fetch: untouched.
- `npm run validate && npm test && npm run build` gates unchanged, plus validator coverage for the mapping file. The script is covered by its own unit tests using fixture ESPN scoreboard/summary payloads (never live network in tests).
- No new secrets or keys: ESPN's API is public and keyless. No browser CORS dependency for the script (it runs in Node).

## 7. Phases

- **6a design (this PR):** this doc + ADR-0005, for Gemini blind review.
- **Freeze:** resolve the open questions below, then mark v1.0 FROZEN.
- **6b build:** ingestion script + mapping file (15 players) + validator extension + tests (including the Kessler/Sabonis/Kyshawn fixture cases), then a PR for Gemini review.
- **6c follow-up (separate design):** scheduled runs — whether a nightly job may run the script and open a PR automatically, and who reviews it.

## 8. Open Questions for Gemini + Product Owner

1. **Report-only vs proposed patch?** The draft has the script print proposed entries for the operator to apply by hand. Should it instead write a patch file (e.g., `ingest-proposal-YYYY-MM-DD.json`) the operator applies with a command, or stay report-only?
2. **Reconciliation scope — check every proposed log, or only the most-recent-in-leg case?** The draft checks only when the comparison is valid (unlocked + most recent in leg). Should it also report the Sleeper value alongside every proposed log for the human to eyeball, even when the formal check does not apply?
3. **Minutes threshold — skip 0-minute players only, or also skip very short appearances?** A player who plays 1 minute and scores 0 still gets a `0.00` log under the draft. Should there be a minimum (e.g., skip lines that score `0.00` with under 5 minutes), or is every appearance a log?
4. **Opponent format — derive home/away from ESPN, or trust the scoreboard?** The draft derives `"OPP"` / `"@OPP"` from which side the player's team is on. Any case where that derivation would be wrong?
5. **Should 6b include backfilling (re-running ingestion over past dates to verify the existing 118 logs), or only forward ingestion?** A backfill run would test the script against known data, but it risks proposing duplicates the operator must reject.
