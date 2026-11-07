# Netrics Phase 1 — Build Notes (local only, not pushed)

Spec: `docs/design/NETRICS-DESIGN-v1.0.md` (FROZEN, GitHub commit 530114ef).
Followed AGENTS.md: scoring engine is the sole place fantasy points are
calculated; no invented stats; no lock/week-matchup code in v1.

## Layout

- `src/scoring/` — `fantasyPoints()` + `ScoreBreakdown` (6-part, sums to total)
- `src/analytics/` — distribution, summary, target evaluation (strict `>`), spike drivers
- `src/data/` — types, loaders, validator, `validate` CLI
- `data/players.json`, `data/game-logs.json` — real seed data only (see SEED-COVERAGE.md)
- No `src/ui/`, no `weeks.json`, no `locks.json`

## Commands

- `npm run validate` — tsc build + validate data files against v1.0 §4
- `npm test` — Vitest
- `npm run build` — `tsc` (typecheck + emit to `dist/`)

## Spec ambiguities hit

1. **Top-3 spike tie at the cut:** v1.0 says "Top 3 games flagged as isSpike"
   but does not say what happens on a tie for 3rd. Implemented: all games
   with total >= the 3rd-highest total are flagged, so a tie does not
   arbitrarily drop one.
2. **Primary driver definition:** v1.0 says "primary non-scoring catalyst or
   dominant category" without a formula. Implemented: largest non-scoring
   contribution among rebounds / playmaking / stocks / bonuses; "scoring"
   only if no non-scoring part is positive.
3. **Median rounding for even GP:** v1.0 says "average of the two middle
   values rounded to 2 decimals" — implemented with round2.

## Corrections found by the tests (2026-11-07)

- **Kessler 2026-11-01 seed log was wrong as first written (tov=0, 48.25).**
  The engine computed 50.25 for 16/15/1/1/3 because the line is a
  double-double (+2). The Sleeper total 48.25 therefore forces tov=2,
  confirmed by the turnover column in the landofbasketball box-score
  table. Seed log and analytics test fixture corrected to tov=2.
  This is exactly the cross-check `expectedTotal` exists for.
- **`round2` normalised -0 to 0** (Vitest `toEqual` distinguishes -0 from 0).
- **`npm run validate` path:** with `rootDir: "."`, tsc emits to
  `dist/src/data/validate-cli.js`, not `dist/data/…`. Script fixed.
- **Missing `@types/node`** for the validate CLI — added as a devDependency.
