# Gemini Independent Blind Review — Phase 6 Design v0.1 (`phase-6/design-v0.1`)

**Reviewer:** Gemini (Goldfish / Stateless Verifier & Senior Software Engineer)
**Date:** 2026-11-07
**Reviewed Artifacts:** `docs/design/NETRICS-DESIGN-PHASE6-v0.1.md` and `docs/decisions/0005-espn-game-log-ingestion.md` (commit `9924a03`)
**Outcome:** All engineering findings and all 5 open product questions resolved with `jiph` and frozen into `docs/design/NETRICS-DESIGN.md` (§4 & §9) and `docs/decisions/0005-espn-game-log-ingestion.md`.

---

## 1. Engineering & Data Provenance Findings

1. **ESPN Team Abbreviation Normalization (`normalizeEspnTeam`):**
   - **Finding:** ESPN's `scoreboard` and `summary` endpoints return 2–4 character team abbreviations (`GS`, `NY`, `NO`, `SA`, `UTAH`, `WSH`) that differ from the canonical 3-letter NBA team codes enforced by `VALID_NBA_TEAMS` in `src/data/validate.ts` (`GSW`, `NYK`, `NOP`, `SAS`, `UTA`, `WAS`). If raw ESPN abbreviations were emitted directly into `GameLog.opponent` (e.g., `"@WSH"` or `"UTAH"`), `npm run validate` would reject the proposed game logs.
   - **Resolution:** Added a pure `normalizeEspnTeam(abbr: string)` function in `src/espn/ingest.ts` mapping `GS -> GSW`, `NY -> NYK`, `NO -> NOP`, `SA -> SAS`, `UTAH -> UTA`, `WSH -> WAS`, and validating that every normalized team and opponent code belongs to `VALID_NBA_TEAMS`.
2. **Header-Driven ESPN Box-Score Stat Parsing:**
   - **Finding:** ESPN's `summary?event={id}` endpoint returns `boxscore.players[]` where each team block provides `statistics[0].labels` (or `names`) such as `["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"]` and `athletes[]` rows with `didNotPlay?: boolean` and `stats: string[]`. Hardcoding array indices is brittle if ESPN reorders columns, and `MIN` can be formatted as `"34"`, `"34:12"`, `"0"`, `"0:00"`, or `"--"` (with `stats: []` on DNP rows).
   - **Resolution:** Required dynamic column lookup by header label (`MIN`, `PTS`, `REB`, `AST`, `STL`, `BLK`, `TO` / `TOV`) and `parseMinutes(raw)` supporting both integer and `MM:SS` strings. Rows with `didNotPlay === true`, `stats.length === 0`, or parsed minutes `<= 0` are skipped as `DNP`.
3. **CLI Path & Build Alignment (`src/espn/ingest-cli.ts`):**
   - **Finding:** `tsconfig.json` has `"rootDir": "src"`, and Phase 1 (`src/data/validate-cli.ts`) and Phase 5b (`src/sleeper/sync-cli.ts`) live under `src/` and compile to `dist/`. Placing the script at `scripts/ingest-espn.ts` outside `src/` would fail `tsc -p tsconfig.json`.
   - **Resolution:** Placed the pure ingestion/reconciliation module at `src/espn/ingest.ts` and the CLI entry point at `src/espn/ingest-cli.ts` (`"ingest:espn": "tsc -p tsconfig.json && node dist/espn/ingest-cli.js"`).
4. **Verified ESPN Athlete IDs & Walker Kessler's 2026–27 Team (`data/espn-player-map.json`):**
   - **Finding:** Draft §5 gave `"4684808"` as an example ESPN athlete ID for Kyshawn George and noted Walker Kessler's `LAL` team as a Sleeper quirk. Cross-checking ESPN's 2026–27 NBA roster snapshot and Wikidata (`P3685`) confirmed Kyshawn George's ESPN athlete ID is `"5174563"` and confirmed Walker Kessler (`"4433136"`) is on the Los Angeles Lakers (`LAL`) in 2026–27 (matching `data/players.json` and his 10 Lakers game logs).
   - **Resolution:** Documented all 15 verified ESPN athlete IDs in `docs/design/NETRICS-DESIGN.md` §9.4 and `data/espn-player-map.json`.

---

## 2. Resolution of Open Design Questions (Confirmed with `jiph`)

1. **Q1 (Output Mode):** Default to read-only stdout (human-readable report + proposed `GameLog[]` JSON array), with an optional `--out <path>` flag that writes the proposed JSON array to a separate file while refusing any target path inside `data/`.
2. **Q2 (Sleeper Reconciliation Scope):** Enforce formal pass/fail reconciliation only when the player is unlocked in the leg and the proposed game is the player's latest game in the leg; display Sleeper's current `players_points[sleeperId]` as informational reference alongside all other proposed logs without failing.
3. **Q3 & Q4 (Minutes Threshold & Opponent Derivation):** Log every completed (`Final`) game where `minutes > 0` (even if `fantasyPoints === 0.00`), skipping only DNP / `0`-minute entries, and derive `"OPP"` (home) / `"@OPP"` (away) using normalized 3-letter NBA team codes (`normalizeEspnTeam`).
4. **Q5 (Forward Ingestion + `--verify-existing` Mode):** Default to forward ingestion (skipping `(sleeperId, date)` already in `data/game-logs.json`), and add an optional `--verify-existing` flag that compares already-committed logs for the requested date(s) against ESPN box-score stats (`pts, reb, ast, stl, blk, tov, opponent`).
