# ADR 0001: v1 Per-Player Analytics Scope, Full Box-Score Invariant, and Elephant-Goldfish Workflow

- **Date:** 2026-11-07
- **Status:** Accepted
- **Deciders:** `jiph` (Owner), Muse (Elephant), Gemini (Goldfish)
- **Related Docs:** `docs/design/NETRICS-DESIGN-v1.0.md`, `docs/reviews/2026-11-07-gemini-blind-review.md`

## Context

During the blind review of `NETRICS-DESIGN-v0.1.md`, we identified three architectural tensions:
1. Lock logic and weekly matchup tracking were deferred in the v0.1 revision header, but `Week` and `Lock` schemas (`data/weeks.json`, `data/locks.json`) and weekly analytics (§5.5–5.7) still remained in the spec.
2. §4 required `fantasyTotal` to be strictly derived from box-score stats (`pts, reb, ast, stl, blk, tov, tf, ff`), while §6 allowed storing unverified weekly totals without stat lines—which would break `fantasyPoints()`, `spikeDrivers()`, and single-game distributions.
3. Multiple agents (`Muse`, `Gemini`, and future agents) will collaborate on `jpham197/netrics` without shared conversational memory.

## Decisions

1. **Strict Per-Player Scope in v1:**
   - Remove `Week` and `Lock` schemas, `data/weeks.json`, `data/locks.json`, weekly bench swing, and weekly matchup totals from v1.
   - Retain per-player Target Score Evaluation (`beatRate` with strict `>`, `beatingGames` with `+margin`, `maxUpside`, `maxDownside`) against any user-selected target score (defaulting in the UI to the player's most recent game score).
2. **Full Box-Score Invariant + Optional `expectedTotal` Cross-Check:**
   - Every entry in `data/game-logs.json` must contain a complete single-game box-score line (`pts, reb, ast, stl, blk, tov`, optional `tf, ff`) and a non-empty `source`.
   - `GameLog` may include an optional `expectedTotal?: number` used **exclusively** by `npm run validate` to assert that `fantasyPoints(log).total === log.expectedTotal`. UI and analytics code must never read `expectedTotal`.
3. **Explicit DD/TD Derivation and Stacking (+5.0 on TD):**
   - Double-doubles (`>= 2` of `[pts, reb, ast, stl, blk]` at `>= 10`) and triple-doubles (`>= 3` at `>= 10`) stack in Sleeper NBA scoring (`+2.0` DD + `+3.0` TD = `+5.0` total).
4. **6-Part Additive Score Breakdown:**
   - `fantasyPoints(log).breakdown` returns `{ scoring, rebounds, playmaking, stocks, bonuses, penalties }` whose sum equals `total`.
5. **Dated Roster Snapshot (`asOf`):**
   - `data/players.json` is wrapped in `{ asOf: "YYYY-MM-DD", leagueId: "1358656481750171649", players: [...] }` so `rosterStatus` is treated as a point-in-time snapshot rather than a permanent fact.
6. **Elephant-Goldfish Multi-Agent Workflow on GitHub:**
   - The repository (`jpham197/netrics`, kept Private with GitHub Actions Pages deployment) is the sole shared memory across agents.
   - All design changes, reviews, and data updates must be committed with explicit provenance and verified via PRs and CI (`npm run validate && npm test && npm run build`).

## Consequences

- **Positive:** v1 data maintenance is simple (`players.json` + `game-logs.json`), every displayed number is 100% reproducible from raw box-score stats, `npm run validate` automatically catches stat-entry errors against Sleeper game totals, and any agent can pick up work from GitHub without conversational context loss.
- **Negative / Trade-off:** A game cannot be added to `data/game-logs.json` until its full 6-category box score is known; weekly matchup / lock-advisor views wait until Phase 3.
