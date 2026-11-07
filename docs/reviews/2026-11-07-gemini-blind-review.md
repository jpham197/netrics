# Gemini Independent ("Goldfish") Blind Review — Netrics Design v0.1

- **Date:** 2026-11-07
- **Target Document:** `docs/design/NETRICS-DESIGN-v0.1.md` (authored by Muse)
- **Reviewer:** Gemini (Goldfish Reviewer — stateless, zero unverified memory assumptions)
- **Decision Status:** **APPROVED WITH REVISIONS → Frozen as `docs/design/NETRICS-DESIGN-v1.0.md`**

---

## 1. Executive Summary

`NETRICS-DESIGN-v0.1.md` gets the core thesis right: **spikes, not averages**, backed by a pure, deterministic scoring engine (`fantasyPoints`) and sourced box-score data.

However, because v0.1 was revised mid-draft to defer lock logic and weekly matchup views to Phase 3, several structural contradictions remained between the revision header (§1, §7, §12.1) and the body of the document (§4, §5, §6, §9). Through a 10-question design interview with the user (`jiph`) on 2026-11-07, all open questions and contradictions have been resolved and incorporated into `docs/design/NETRICS-DESIGN-v1.0.md`.

---

## 2. Responses to §13 Reviewer Checklist

### 2.1 Is the scoring formula complete and unambiguous, including bonuses and TD stacking?
**Finding in v0.1:** Almost, with three ambiguities that needed tightening before code:
1. **`isDoubleDouble` and `isTripleDouble` derivation:** §3 referenced `isDoubleDouble` and `isTripleDouble` as booleans, while §4 omitted them from `GameLog`. A naive implementation could either require boolean flags in JSON or accidentally include turnovers (`tov >= 10`, a "cripple-double") in the count.
2. **Triple-double stacking (§12.5):** Left open in v0.1. In Sleeper NBA scoring, a triple-double increments both `dd` (+2.0) and `td` (+3.0) for **+5.0 total**.
3. **`breakdown` structure:** §3 returned `{ total, breakdown }` and §5.4 listed `pts / reb / ast / stocks (stl+blk)`, which do not sum to `total` whenever bonuses (`dd`, `td`, `40p`, `50p`, `15a`, `20r`) or penalties (`tov`, `tf`, `ff`) are non-zero.

**Resolution in v1.0:**
- Explicitly define `qualifyingCategories = [pts, reb, ast, stl, blk].filter(v => v >= 10).length`, with `isDoubleDouble = qualifyingCategories >= 2` and `isTripleDouble = qualifyingCategories >= 3`.
- Lock in **stacked DD + TD (+5.0 total on a TD)** and require a Phase 1 unit test against a verified Cade Cunningham / Domantas Sabonis Sleeper triple-double game.
- Define a 6-part additive `ScoreBreakdown` (`scoring`, `rebounds`, `playmaking`, `stocks`, `bonuses`, `penalties`) guaranteed to sum to `total`.

---

### 2.2 Is the data model sufficient, or is a field missing / extraneous?
**Finding in v0.1:**
1. **Leftover deferred schemas:** `Week` and `Lock` (`data/weeks.json`, `data/locks.json`) remained in §4 and §6 despite lock/matchup logic being deferred to Phase 3.
2. **Contradiction between §4, §6, and §9 on `fantasyTotal` and weekly totals:**
   - §4 stated: *"`fantasyTotal` is never hand-entered; it is always recomputed."*
   - §6 stated: *"Where a full line cannot be verified, store the weekly total only and mark the line `unverified — total only`."*
   - §9 stated: *"`npm run validate` fails on ... a stored total that disagrees with the engine."*
   Storing a *weekly* (multi-game) total in `game-logs.json` would corrupt a game-by-game distribution, and omitting box-score stats breaks both `fantasyPoints()` and `spikeDrivers()`.
3. **Missing snapshot timestamp for `rosterStatus` (§12.3):** `Player.rosterStatus` (`"starter" | "bench" | "reserve"`) had no `asOf` date, even though §12.3 noted lineup churn between Nov 6 and Nov 7.

**Resolution in v1.0:**
- Strip `Week`, `Lock`, `data/weeks.json`, and `data/locks.json` from v1.
- Require full box-score stats (`pts, reb, ast, stl, blk, tov`, optional `tf, ff`) on every `GameLog`. Never store weekly totals in `game-logs.json`.
- Add an optional validation-only field `expectedTotal?: number` on `GameLog`. The UI and analytics engine **never** read `expectedTotal`; `npm run validate` uses it to assert `fantasyPoints(log).total === log.expectedTotal` whenever present.
- Wrap `data/players.json` in a `PlayersFile` envelope with `asOf: string` (`YYYY-MM-DD`) and `leagueId: string` so `rosterStatus` is explicitly rendered as a dated snapshot.

---

### 2.3 Does any analytics claim invent a probability or use an average as a ceiling?
**Finding in v0.1:** No invented probabilities, and mean is properly subordinated to median/ceiling. However:
1. Items §5.5 (remaining-games lock EV), §5.6 (weekly bench swing), and §5.7 (week matchup) referenced deferred weekly/lock concepts.
2. The exact comparison operator for `beatRate` (`>` vs. `>=`) was only implied by Kessler's example (`46.00` beaten in `2 of 9` games despite `46.00` being one of the 9 games).

**Resolution in v1.0:**
- Strip weekly matchup / bench swing / remaining-games logic (§5.5–5.7) from v1.
- Keep per-player **Target Score Evaluation**: given any target score $T$ (defaulting in the UI to the player's most recent game score), compute:
  - `beatCount`: count of games where `score > T` (strict `>`)
  - `beatRate`: `beatCount / gamesPlayed`
  - `beatingGames`: games with `score > T` and `margin = score - T`
  - `maxUpside`: `max(0, ceiling - T)`
  - `maxDownside`: `max(0, T - floor)`

---

### 2.4 Is the manual-data flow workable weekly, or is it too burdensome?
**Finding in v0.1:** For 15 roster players (~45–55 games per week across the roster), hand-editing raw JSON without a validator cross-check is error-prone.
**Resolution in v1.0:**
- Eliminating `weeks.json` and `locks.json` reduces v1 maintenance to appending new game logs to `data/game-logs.json` (and updating `rosterStatus` / `asOf` in `data/players.json` when desired).
- Adding `expectedTotal?: number` to `GameLog` lets `npm run validate` immediately catch any stat-entry typo where the box score doesn't sum to Sleeper's reported game score.

---

### 2.5 Resolution of All §12 Open Questions

| # | Open Question in v0.1 | v1.0 Resolution (User-Confirmed 2026-11-07) |
|---|---|---|
| 1 | Lock mechanics in Sleeper (Markkanen 47.50 vs 39.50) | **Deferred to Phase 3.** v1 has no lock logic, `Week`, or `Lock` schemas. |
| 2 | Kyshawn vs. Keyonte George | **Resolved:** Kyshawn George (`WAS`, Sleeper ID `2714`). |
| 3 | Lineup churn (`rosterStatus`) | **Resolved:** `data/players.json` includes top-level `asOf: "YYYY-MM-DD"`; UI displays `rosterStatus` as a dated snapshot. |
| 4 | Team abbreviations (`LAL` Kessler, `OKC` McCain, etc.) | **Resolved:** Verify each player's `team` against the actual Sleeper API / 2026-27 NBA roster during Phase 1 seed validation; never overwrite from memory. |
| 5 | Triple-double stacking | **Resolved:** DD (`+2`) and TD (`+3`) stack for **+5.0 total** on a triple-double; verify with a Phase 1 unit test on a Cade/Sabonis Sleeper TD game. |
| 6 | Repo visibility & GitHub Pages | **Resolved:** Keep `jpham197/netrics` **Private** (user has GitHub Pro + authenticated access for Muse) and deploy via GitHub Actions to GitHub Pages. |
| 7 | Game-log source for v1 seed | **Resolved:** Sleeper per-game box scores + NBA / Basketball-Reference verification, with optional validation-only `expectedTotal` cross-checked by `npm run validate`. |

---

### 2.6 What Was Changed Before Any Code Is Written

1. Created `docs/design/NETRICS-DESIGN-v1.0.md` freezing the cleaned v1 specification.
2. Created `docs/decisions/0001-v1-per-player-analytics-and-data-invariants.md` (ADR-0001).
3. Created `AGENTS.md` codifying the **Elephant-Goldfish multi-agent model** between Muse, Gemini, and future agents via GitHub branches, PRs, CI checks, and repo-committed artifacts.
