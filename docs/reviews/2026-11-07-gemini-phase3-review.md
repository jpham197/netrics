# Independent Goldfish Review — Phase 3 Design v0.1 (`NETRICS-DESIGN-PHASE3-v0.1.md` & `ADR-0002`)

**Date:** 2026-11-07
**Reviewer:** Gemini (Goldfish — Stateless Verifier & Senior Software Engineer)
**Target PR:** `https://github.com/jpham197/netrics/pull/4` (`phase-3/design-v0.1`)
**Reviewed Artifacts:**
- `docs/design/NETRICS-DESIGN-PHASE3-v0.1.md`
- `docs/decisions/0002-phase3-lock-record-and-advisor-ev.md`
- `data/game-logs.json` (cross-checked against §2.2, §2.3, §2.5, and §4.4)

---

## Executive Verdict

The core architecture in `NETRICS-DESIGN-PHASE3-v0.1.md` and `ADR-0002` — treating `data/locks.json` as the sole lock source of truth, scoping weeks to Monday–Sunday Sleeper legs in `data/weeks.json`, and grounding Lock Advisor decisions in expected value over the player's own empirical game distribution — is sound and faithful to `AGENTS.md`.

However, independent verification uncovered **three mathematical/logic bugs** (including a denominator error in the Kessler §4.4 worked example and a bounds error for locked starters in §5), **one schema contradiction** between §3.1 and §3.2 (`Jarace Walker 2563`), and **primary-source box-score resolutions for both §2.5 data anomalies** (`Sabonis 35.50` and `Kyshawn George 57.00`).

All findings below have been resolved in `docs/design/NETRICS-DESIGN-PHASE3-v1.0.md`, `docs/decisions/0002-phase3-lock-record-and-advisor-ev.md`, and `data/game-logs.json`.

---

## 1. Mathematical & Advisor Logic Findings (§4)

### 1.1 Critical Bug: `meanShortfall(B)` Denominator Inconsistency on Tied Games (`total === B`)

- **What v0.1 §4.1 & §4.4 said:**
  - §4.1 defined `meanShortfall(B)` as the *"mean of `(B − total)` over the non-beating games (0 if all beat `B`)"*.
  - In **§4.4 Example 2 (Avdija, `B = 46.75`, 7 games)**, 1 game beat `46.75` and 6 games had `total <= 46.75` (including the `46.75` game itself with `shortfall = 0.00`). The draft divided the shortfall sum by **all 6 non-beating games** (`35.50 / 6 = 5.92`).
  - In **§4.4 Example 1 (Kessler, `B = 38.00`, 10 games)**, 6 games beat `38.00` (`42.75, 62.50, 45.25, 48.25, 43.75, 46.00`) and **4 games** did not beat `38.00` (`12.75, 28.00, 32.75`, and `38.00` itself with `shortfall = 0.00`). However, the draft divided `40.50` by **3** (`40.50 / 3 = 13.50`, excluding the tied `38.00` game) and then multiplied `13.50` by `1 - pAnyBeat = 0.40` (`4/10`, which **includes** the tied `38.00` game).
- **Why this is mathematically wrong:**
  - Because `beatRate(B)` uses strict inequality (`total > B`), its complement `1 - beatRate(B)` is the probability $P(X \le B)$, which includes ties ($X = B$).
  - By the law of total expectation, for $n = 1$ remaining game:
    $$\mathbb{E}[X - B] = P(X > B)\,\mathbb{E}[X - B \mid X > B] - P(X \le B)\,\mathbb{E}[B - X \mid X \le B]$$
  - For this identity to hold, $\text{meanShortfall}(B) = \mathbb{E}[B - X \mid X \le B]$ **must** divide by the count of all non-beating games ($X \le B$, with ties contributing $0.00$).
  - Checking Kessler ($N = 10$, sum of 10 games = `400.00`, mean = `40.00`, $B = 38.00$, $n = 1$):
    - Replacing `38.00` with 1 random draw from a distribution whose mean is `40.00` has an exact expected gain of $\mathbb{E}[X - 38.00] = 40.00 - 38.00 = +2.00$.
    - With the correct denominator (`4` non-beating games: shortfalls `25.25, 10.00, 5.25, 0.00`), `meanShortfall = 40.50 / 4 = 10.125` (`10.13`), and:
      $$\text{rideEV}(38.00, 1) = 0.60 \times \frac{60.50}{6} - 0.40 \times \frac{40.50}{4} = 6.05 - 4.05 = +2.00$$
- **Resolution in v1.0:**
  - Explicitly define `nonBeatingGames` as all logged games with `total <= B` (including ties with `shortfall = 0`), so `meanShortfall(B) = sum(B - g.total for g in nonBeatingGames) / nonBeatingGames.length`.
  - Corrected the Kessler §4.4 worked example to `meanShortfall = 40.50 / 4 = 10.13` and `rideEV = +2.00` (**RIDE**).

### 1.2 Sleeper Sequential Lock Mechanics vs. §4.3.3 ("Lock the Best Remaining Outcome")

- **What v0.1 §4.3.3 said:**
  - *"Ride = lock the best remaining outcome: the EV model assumes the manager can lock after any remaining game and will take the best one."*
- **Why this wording misstates both Sleeper's rule and the §4.1 formula:**
  - In Sleeper Lock-In, a manager cannot wait until all $n$ remaining games finish and retroactively lock $\max(X_1, \dots, X_n)$; once game $k+1$ tips off, game $k$ can no longer be locked.
  - Furthermore, the formula in §4.1 (`rideEV = pAnyBeat * meanUpside - (1 - pAnyBeat) * meanShortfall`) does **not** compute $\mathbb{E}[\max(X_1, \dots, X_n) - B]$ (which would have a higher conditional upside than `meanUpside` when $n \ge 2$).
  - Instead, `pAnyBeat * meanUpside - (1 - pAnyBeat) * meanShortfall` is the **exact expected value** of the legal Sleeper sequential stopping strategy:
    > **"Ride and lock the FIRST remaining game that strictly beats $B$; if none of the $n$ remaining games beat $B$, end the week with the final game $X_n$."**
  - Proof: Under i.i.d. draws from the player's distribution, stopping at the first game $X_k > B$ succeeds with probability $1 - (1 - \text{beatRate}(B))^n = \text{pAnyBeat}(B, n)$, and conditional on $X_k > B$, the stopped score is a single draw from $(X \mid X > B)$ with expected gain $\text{meanUpside}(B)$. If all $n$ draws satisfy $X_i \le B$ (probability $1 - \text{pAnyBeat}(B, n)$), the final game $X_n$ is distributed as $(X \mid X \le B)$ with expected loss $\text{meanShortfall}(B)$.
- **Resolution in v1.0:**
  - Updated §4.1, §4.3.3, and `ADR-0002` to state the exact sequential rule: riding means locking the **first** remaining game that strictly beats `B` (or taking the final remaining game if none beat `B`).

### 1.3 Intermediate Rounding & Advisor Edge States (`LOCKED`, `NO_GAMES_LEFT`, `NO_BANKED_SCORE`, `nearCeiling`)

- **Rounding contract:** In §4.4 Example 2 (Avdija), unrounded `(1/7) * 2.00 - (6/7) * (35.50 / 6) = -33.50 / 7 = -4.7857...` rounds to **`-4.79`**, whereas rounding `(1/7) * 2.00` to `0.29` and `(6/7) * 5.92` to `5.07` yields `0.29 - 5.07 = -4.78`.
  - **Rule in v1.0:** Compute `rideEV` from unrounded `pAnyBeat`, `meanUpsideRaw`, and `meanShortfallRaw`, then apply `round2()` to `meanUpside`, `meanShortfall`, and `rideEV` at the boundary. This guarantees that for $n = 1$, `rideEV(B, 1) === round2(mean - B)` without double-rounding drift.
- **Advisor status & recommendation states:**
  - `LOCKED`: player has a `LockRecord` in `locks.json` for this leg (`rideEV` not applicable; display `lockGainVsLatest = round2(lockedTotal - latestLegGame.total)`).
  - `NO_GAMES_LEFT`: player is unlocked and `n === 0` (`rideEV = 0`, week score is final unless locked as-is).
  - `NO_BANKED_SCORE`: player is unlocked and has no completed game in this leg yet (`B === null`) or `gamesPlayed === 0`.
  - Active decision (`unlocked`, `B !== null`, `n > 0`, `gamesPlayed > 0`): returns `LOCK` (`rideEV <= 0`), `RIDE` (`rideEV > 0 && pAnyBeat >= 0.5`), or `LEAN_RIDE` (`rideEV > 0 && pAnyBeat < 0.5`), plus boolean `nearCeiling: ceiling !== null && B >= ceiling - 2.00` and `maxGainToCeiling = Math.max(0, round2(ceiling - B))`.

---

## 2. Primary-Source Resolution of Both §2.5 Data Anomalies

### 2.1 Domantas Sabonis (`1739`) on `2026-11-06 vs SAS` — `35.50` Explained (`ff: 1`)

- **The puzzle in v0.1 §2.5:** Sabonis's `2026-11-06 vs SAS` box score (`17 pts, 12 reb, 5 ast, 0 stl, 0 blk, 4 tov`) scored `37.50` in `data/game-logs.json`, while Sleeper's live Leg 3 matchup scored him at **`35.50`** (`2.00` points lower).
- **Verified root cause:** With `0:31.2` remaining in Q2 (`SAS @ SAC`, Nov 6, 2026), Domantas Sabonis committed a reckless closeout foul on a Victor Wembanyama 3-point attempt that was upgraded on referee review to a **Flagrant Foul Penalty 1 (`ff: 1`)**, and Wembanyama shot 3 flagrant free throws (`SI.com` play-by-play `Q2 00:31`, confirmed by `San Antonio Express-News` and `ClutchPoints`).
- **Exact math:** Under Beltline Ballers scoring (`NETRICS-DESIGN-v1.0.md` §2), `ff: 1` is **`-2.00` points**:
  $$17.00\text{ (pts)} + 15.00\text{ (12 reb)} + 7.50\text{ (5 ast)} + 2.00\text{ (DD)} - 4.00\text{ (4 tov)} - 2.00\text{ (1 ff)} = \mathbf{35.50}$$
- **Action taken:** Updated Sabonis's `2026-11-06 vs SAS` entry in `data/game-logs.json` with `"ff": 1` and `"expectedTotal": 35.50`, and added this real `ff: 1` game to `src/scoring/scoring.test.ts`.

### 2.2 Kyshawn George (`2714`) on `2026-11-06 @ATL` — `57.00` Confirmed (`ast: 8`)

- **The conflict in v0.1 §2.5:** Early wire recaps listed `7 ast` (`55.50`), whereas `Basketball-Reference` (`202611060ATL`), `FOX Sports` (`boxscore-106655`), `FantasyData`, and `Sleeper` (`matchups/3`) all credit Kyshawn George with **`8 ast`** (`33 pts, 4 reb, 8 ast, 1 stl, 2 blk, 2 tov` = **`57.00`**).
- **Action taken:** Updated Kyshawn George's `2026-11-06 @ATL` entry in `data/game-logs.json` to `"ast": 8, "expectedTotal": 57.00`. With Sabonis (`35.50`) and Kyshawn George (`57.00`) updated, **all 9 starters in Leg 3 sum to `407.25` in Netrics, matching Sleeper's `407.25` with zero discrepancy.**

---

## 3. Data Schema & Matchup/Bench Swing Findings (§3, §5, §6)

### 3.1 Schema Contradiction Between §3.1 Invariant 4 and §3.2 (`Jarace Walker 2563` & `bench.length === 5`)

- **Finding:**
  1. §3 stated *"No changes to `players.json` or `game-logs.json`"*, §3.1 Invariant 4 required *"every id in `WeekRecord` must exist in `players.json`"*, and §3.2 stated Leg 2's `WeekRecord` includes `Jarace Walker (2563)` — who is not in `players.json`. That combination would cause `npm run validate` to fail immediately on Leg 2.
  2. §3.1 Invariant 4 required *"exactly 5 `bench`"*, which fails in any week where a manager has an open bench spot or moves a player between Bench and IR.
- **Resolution in v1.0:**
  - In `WeekRecord`: require `starters.length === 9`, `bench.length <= 6`, `reserve.length <= 2`, with no duplicate `sleeperId` across `starters`, `bench`, and `reserve`.
  - Every `sleeperId` in `WeekRecord` must exist in `players.json`. To support historical weeks (Legs 1–2) where dropped players like `Jarace Walker (2563)` appeared, either:
    - Phase 3b seeds `weeks.json` with Leg 3 (all 15 current roster players in `players.json`), **or**
    - If Legs 1–2 are seeded in `weeks.json`, `RosterStatus` in `players.json` adds `"former"` (excluded from the active Roster View groups `Starters / Bench / Reserve / IR`) and includes Jarace Walker (`2563`) + his verified Leg 1–2 game logs in `game-logs.json`.

### 3.2 Matchup View Bounds Bug for Locked or Completed Starters (§5)

- **Finding:** v0.1 §5 defined user best case as `sum(max(banked, ceiling))` and user worst case as `sum(min(banked, floor))` across all 9 starters. For a starter who is **already locked** (e.g., Markkanen locked at `47.50`, floor `2.00`) or who is **unlocked with `n === 0` remaining games**, their week score is final (`banked`). Using `min(banked, floor)` would falsely count Markkanen's worst case for Leg 3 as `2.00` instead of `47.50`.
- **Resolution in v1.0:**
  - If a starter is **locked** OR (`n === 0` and `banked !== null`):
    `starterBestCase = banked` and `starterWorstCase = banked`.
  - If a starter is **unlocked** and `n > 0`:
    `starterBestCase = Math.max(banked ?? 0, ceiling ?? 0)` and `starterWorstCase = floor ?? banked ?? 0` (if ridden; or `banked` if locked now).

---

## 4. Answers to §9 Open Questions

1. **Q1 — Sabonis `35.50`:** Resolved via play-by-play verification (`ff: 1` Flagrant 1 foul on Wembanyama at `Q2 00:31.2` on `2026-11-06 vs SAS`; `37.50 - 2.00 = 35.50`). Updated in `data/game-logs.json`.
2. **Q2 — Kyshawn George `57.00` vs `55.50`:** Resolved in favor of `8 ast / 57.00` (`Basketball-Reference`, `FOX Sports`, `FantasyData`, and `Sleeper`). Updated in `data/game-logs.json`.
3. **Q3 — Opponent data (live fetch vs. static/manual):** Store a verified opponent snapshot (`opponentPoints`, `opponentAsOf`, and optional `opponentPlayers` list) inside each `WeekRecord` in `data/weeks.json` so the Matchup View works deterministically offline and in tests with zero network dependency, plus support an optional client-side manual override or live refresh from Sleeper's read-only `matchups/{leg}` endpoint.
4. **Q4 — Lock entry (`locks.json` vs. UI form):** Use `data/locks.json` as the canonical persisted source of truth in Phase 3b. The UI may optionally provide a local "what-if" lock toggle in state, clearly labelled as a preview.
5. **Q5 — Advisor EV model vs. simple threshold:** Keep the **EV model (`rideEV`)** paired with `pAnyBeat >= 0.5` (`RIDE` vs `LEAN RIDE`), with the corrected `meanShortfall` denominator (`total <= B`) and sequential stopping rule wording.
6. **Q6 — Opponent best/worst-case bounds:** Show **opponent current total + remaining games only** (when known), with no invented opponent ceiling/floor bounds.
