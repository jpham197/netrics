# Netrics — Phase 3 Specification v1.0 (FROZEN)

**Status:** FROZEN — Reviewed by Gemini (`docs/reviews/2026-11-07-gemini-phase3-review.md`) and ready for Phase 3b implementation.
**Date:** 2026-11-07
**Authors:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)
**Repo:** `jpham197/netrics` (public GitHub repo, Vite + React + TypeScript, GitHub Pages via GitHub Actions)
**League:** Sleeper NBA Lock-In Redraft, "Beltline Ballers", `league_id`: `1358656481750171649`
**Depends on:** `docs/design/NETRICS-DESIGN-v1.0.md` (FROZEN) — scoring engine, analytics, data invariants, and UI in v1 are unchanged by this doc. Phase 3 adds two data files (`data/weeks.json`, `data/locks.json`), one pure engine module (`src/advisor/`), and two views (`Lock Advisor`, `Matchup + Bench Swing`) on top of v1.

---

## 1. Problem & Phase 3 Scope

v1 answers, per player: what is this player's game-by-game distribution, ceiling, beat-rate, and what drives his spikes. Phase 3 answers the three weekly lineup decisions:

1. **Lock or ride?** A starter has a score banked from an earlier game this week and `n` games left in the leg. Should the manager lock the banked score or let it ride?
2. **Am I winning the week?** What is the user's current week total vs. the opponent's, with games still to play and best/worst-case bounds?
3. **Is a bench swap worth it?** Would swapping a bench player into an eligible starter slot gain points this week?

### Phase 3 Scope

- **Lock Advisor (`src/advisor/` + UI):** Per-starter status and recommendation (`LOCK`, `RIDE`, `LEAN_RIDE`, `LOCKED`, `NO_GAMES_LEFT`, `NO_BANKED_SCORE`) with full expected-value math (`beatRate`, `pAnyBeat`, `meanUpside`, `meanShortfall`, `rideEV`) grounded strictly in the player's own game distribution — never in a season average.
- **Weekly Matchup View (`src/ui/`):** User week total vs. opponent week total, remaining games, and user best/worst-case bounds.
- **Bench Swing (`src/advisor/` + UI):** Ranked list of bench-for-starter swaps with positive point swing (`swing > 0`), respecting Sleeper slot position eligibility (`PG, SG, G, SF, PF, F, C, UTIL, UTIL`).
- **New Data Files:** `data/weeks.json` (per-leg week snapshots) and `data/locks.json` (user-entered lock records), validated by `npm run validate`.

---

## 2. Verified Lock Mechanics — How Sleeper Scores a Lock-In Week

Every claim below was checked against the Sleeper API on 2026-11-07 and cross-checked against `data/game-logs.json` (118 verified game logs).

### 2.1 The Rule

For each rostered player, Sleeper's week score (`players_points` in `GET /league/{id}/matchups/{leg}`, and the matching slot in `starters_points`) is:

- **the locked score, if the manager locked that player during that leg;**
- **otherwise, the player's most recent completed game of that leg.**

A locked score freezes even if the player plays again later in the leg, and even if the player is later moved to the bench. An unlocked player's score updates to each newly completed game until the leg ends (or the manager locks that game before the player's next game tips off).

### 2.2 Evidence — Leg 2 (Final; `last_scored_leg: 2`, Oct 26 – Nov 1, 2026)

| Player | Sleeper wk-2 score | Seed logs that leg (most recent last) | Verdict |
|---|---:|---|---|
| Fears (`4750`) | 36.75 | Oct 28 20.50, Oct 29 68.50, Oct 31 36.75 | Most recent ✓ |
| Avdija (`2181`) | 33.25 | Oct 27 41.50, Oct 29 48.75, Oct 31 33.25 | Most recent ✓ |
| Cade (`2267`) | 31.25 | Oct 27 42.25, Oct 28 51.75, Oct 30 31.25 | Most recent ✓ |
| Paul George (`1074`) | 44.50 | Oct 27 42.25, Oct 30 44.50, Nov 1 44.50 | Most recent ✓ |
| Markkanen (`1752`) | 32.00 | Oct 26 2.00, Oct 31 32.00 | Most recent ✓ |
| Traore (`4742`) | 29.50 | Oct 27 24.75, Oct 30 20.50, Nov 1 29.50 | Most recent ✓ |
| Kyshawn (`2714`) | 21.25 | Oct 26 27.00, Oct 28 30.00, Oct 30 21.25 | Most recent ✓ |
| McCain (`2713`) | 19.00 | Oct 26 31.75, Oct 28 18.00, Oct 31 19.00 | Most recent ✓ |
| Kessler (`2441`) | **45.25** | Oct 27 28.00, Oct 28 32.75, Oct 30 45.25, Nov 1 48.25 | **Locked** at Oct 30 (Nov 1's 48.25 did not replace it) |
| Sabonis (`1739`) | **49.50** | Oct 27 49.50, Oct 29 40.25, Oct 31 43.50 | **Locked** at Oct 27 (later games did not replace it) |

**Legs run Monday–Sunday**, with Leg 1 truncated to the season start (Tue Oct 20 – Sun Oct 25), Leg 2 = Oct 26 – Nov 1, and Leg 3 = Nov 2 – Nov 8.

### 2.3 Evidence — Leg 3 (Live; `leg: 3`, Nov 2 – Nov 8, 2026)

All 9 starters and bench players reconcile 100% against `data/game-logs.json`:

| Player | Sleeper leg-3 score | Seed logs this leg | Verdict |
|---|---:|---|---|
| Cade (`2267`) | 61.75 | Nov 2 61.75, Nov 4 58.25 | Locked at Nov 2 (user-confirmed) |
| Avdija (`2181`) | 46.75 | Nov 2 37.25, Nov 4 46.75, Nov 6 49.75 | Locked at Nov 4 (user-confirmed) |
| Fears (`4750`) | 41.75 | Nov 2 23.50, Nov 4 33.50, Nov 6 41.75 | Locked at Nov 6 (user-confirmed) |
| Markkanen (`1752`) | 47.50 | Nov 2 39.50, Nov 4 47.50, Nov 6 33.50 | Locked at Nov 4 (user-confirmed) |
| Sabonis (`1739`) | 35.50 | Nov 2 22.75, Nov 4 41.75, Nov 6 35.50 (`ff: 1`) | Most recent ✓ (unlocked; Nov 6 includes Flagrant 1 foul `-2.00`) |
| Kyshawn (`2714`) | 57.00 | Nov 2 39.50, Nov 4 36.50, Nov 6 57.00 (`8 ast`) | Most recent ✓ (unlocked) |
| Kessler (`2441`) | 38.00 | Nov 2 43.75, Nov 4 46.00, Nov 6 38.00 | Most recent ✓ (unlocked; user declined to lock 46.00) |
| Edgecombe (`4737`) | 37.75 | Nov 2 37.25, Nov 4 23.00, Nov 6 37.75 | Most recent ✓ (unlocked) |
| McCain (`2713`) | 41.25 | Nov 2 20.25, Nov 4 11.25, Nov 6 41.25 | Most recent ✓ (unlocked) |
| Paul George (`1074`, bench) | 42.25 | Nov 4 42.25, Nov 6 21.75 | Locked at Nov 4 — lock persists on the bench |
| Bey (`2131`, bench) | 31.25 | Nov 2 28.75, Nov 4 33.50, Nov 6 31.25 | Most recent ✓ (unlocked) |

User Leg 3 total across the 9 starters: `61.75 + 46.75 + 41.75 + 47.50 + 35.50 + 57.00 + 38.00 + 37.75 + 41.25 = 407.25`. Opponent (`roster_id: 8`, `notNoah224`) total as of snapshot: `317.25`.

### 2.4 Why `data/locks.json` Is the Sole Lock Source of Truth

On Nov 7 ~10:56 AM ET, Sleeper's live `starters_points` briefly showed `39.50` for Markkanen before updating to his locked `47.50` by ~1:24 PM ET. Because Sleeper exposes no lock endpoint and live `players_points` can lag lock actions, **Netrics never infers locks from Sleeper's live scores.** A player is treated as locked in Netrics if and only if a `LockRecord` exists in `data/locks.json`.

---

## 3. Data Model (`src/data/` + `data/`)

Two new JSON files under `data/`: `data/weeks.json` and `data/locks.json`.

```ts
export interface OpponentPlayerScore {
  name: string;
  position?: string;
  team?: string;
  points: number;
}

export interface WeekRecord {
  leg: number;                            // Sleeper leg, e.g. 3
  startDate: string;                      // YYYY-MM-DD, Monday (leg 1: 2026-10-20)
  endDate: string;                        // YYYY-MM-DD, Sunday
  matchupId: number;                      // Sleeper matchup_id for the user's matchup that leg
  opponentRosterId: number;               // Sleeper roster_id of the opponent
  opponentName: string;                   // Sleeper username, e.g. "notNoah224"
  opponentPoints: number;                 // Snapshot of opponent's week total from Sleeper
  opponentAsOf: string;                   // ISO date/timestamp of opponent snapshot
  opponentRemainingGames?: number;        // Optional count of opponent starter games remaining
  opponentPlayers?: OpponentPlayerScore[];// Optional starter breakdown from Sleeper snapshot
  starters: string[];                     // 9 sleeperIds in slot order (PG, SG, G, SF, PF, F, C, UTIL, UTIL)
  bench: string[];                        // Bench sleeperIds for that leg (up to 6)
  reserve: string[];                      // Reserve / IR sleeperIds for that leg (up to 2)
  // Remaining unplayed games per player in this leg, by YYYY-MM-DD date.
  remainingGames: Record<string, string[]>;
}

export interface WeeksFile {
  leagueId: string;                       // "1358656481750171649"
  weeks: WeekRecord[];
}

export type LockSource = "user" | "sleeper-verified";

export interface LockRecord {
  sleeperId: string;                      // Foreign key -> Player.sleeperId
  leg: number;                            // Leg the lock belongs to (must exist in weeks.json)
  gameDate: string;                       // YYYY-MM-DD of the locked game (must exist in game-logs.json)
  lockedTotal: number;                    // Must equal fantasyPoints(that game log).total
  lockedAt: string;                       // ISO 8601 timestamp when locked, or "" if unknown
  source: LockSource;                     // "user" or "sleeper-verified"
  note?: string;
}

export interface LocksFile {
  leagueId: string;
  locks: LockRecord[];
}
```

### 3.1 Data Invariants (Enforced by `npm run validate` in Phase 3b)

1. **One lock per `(sleeperId, leg)`:** At most one `LockRecord` per player per leg.
2. **Lock ↔ log consistency:** Every `LockRecord` must reference an existing `GameLog` with matching `(sleeperId, gameDate)` in `data/game-logs.json`, and `lockedTotal === fantasyPoints(log).total`.
3. **Leg bounds:** `LockRecord.leg` must exist in `data/weeks.json`, and `LockRecord.gameDate` must satisfy `week.startDate <= gameDate <= week.endDate`.
4. **Week completeness & referential integrity:**
   - Each `WeekRecord` must have `startDate <= endDate`, `starters.length === 9`, `bench.length <= 6`, `reserve.length <= 2`, and no duplicate `sleeperId` across `starters`, `bench`, and `reserve`.
   - Every `sleeperId` in `starters`, `bench`, `reserve`, and ` Object.keys(remainingGames)` must exist in `data/players.json`. (If historical legs with dropped players such as `Jarace Walker 2563` are included in `weeks.json`, those players must be present in `players.json` with `rosterStatus: "former"` and their verified logs in `game-logs.json`; otherwise `weeks.json` seeds active-roster legs starting with Leg 3.)
   - Every date in `remainingGames[sleeperId]` must fall within `[startDate, endDate]` and must **not** already exist as a completed `(sleeperId, date)` in `data/game-logs.json`.

---

## 4. Lock Advisor Math Contract (`src/advisor/`)

Pure TypeScript module (`src/advisor/index.ts`) with zero UI or network dependencies.

### 4.1 Definitions

Given a player's full season scored distribution `distribution: ScoredGame[]` (`N = distribution.length`), their current leg games (`legGames` filtered to `[week.startDate, week.endDate]`), optional `lock: LockRecord | null`, and `n = remainingGames.length` remaining games in the leg:

1. **Banked Score (`B`):**
   - If `lock !== null`, `B = lock.lockedTotal` (from the locked game on `lock.gameDate`).
   - Else if `legGames.length > 0`, `B = latestLegGame.total` (the `ScoredGame` in `legGames` with the greatest `date`).
   - Else `B = null`.
2. **Conditional Distribution Metrics (for any numeric `B` when `N > 0`):**
   - `beatingGames`: games in `distribution` with `g.total > B` (strict `>`).
   - `nonBeatingGames`: games in `distribution` with `g.total <= B` (includes ties `g.total === B` with `0` shortfall).
   - `beatRate = beatingGames.length / N` (`0..1`).
   - `meanUpsideRaw = beatingGames.length > 0 ? sum(g.total - B) / beatingGames.length : 0`
   - `meanShortfallRaw = nonBeatingGames.length > 0 ? sum(B - g.total) / nonBeatingGames.length : 0`
   - `meanUpside = round2(meanUpsideRaw)`
   - `meanShortfall = round2(meanShortfallRaw)`
3. **Multi-Game Sequential Stopping Probability & Expected Value (`n` remaining games):**
   - Under the sequential strategy **"Ride and lock the FIRST remaining game that strictly beats `B`, or take the final remaining game of the week if none beat `B`"**:
     - `pAnyBeat = n > 0 ? 1 - Math.pow(1 - beatRate, n) : 0`
     - `rideEV = n > 0 ? round2(pAnyBeat * meanUpsideRaw - (1 - pAnyBeat) * meanShortfallRaw) : 0`
   - **Mathematical identity for $n = 1$:** Because `nonBeatingGames` includes `g.total === B` and `rideEV` is computed from unrounded intermediates, `rideEV(B, 1)` always equals `round2(mean(distribution) - B)`.

### 4.2 Advisor Status & Recommendation Rules

1. **If `lock !== null`:**
   - `status = "LOCKED"`, `recommendation = null`.
   - Reports `lockedTotal`, `lock.gameDate`, `latestLegGame`, and `lockGainVsLatest = latestLegGame ? round2(lock.lockedTotal - latestLegGame.total) : 0`.
2. **Else if `B === null` or `N === 0`:**
   - `status = "NO_BANKED_SCORE"`, `recommendation = null`.
3. **Else if `n === 0`:**
   - `status = "NO_GAMES_LEFT"`, `recommendation = null`, `rideEV = 0`.
4. **Else (`lock === null`, `B !== null`, `N > 0`, `n > 0`):**
   - `status = "DECISION"`
   - `recommendation`:
     - `"LOCK"` if `rideEV <= 0`
     - `"RIDE"` if `rideEV > 0 && pAnyBeat >= 0.5`
     - `"LEAN_RIDE"` if `rideEV > 0 && pAnyBeat < 0.5`
   - `nearCeiling = ceiling !== null && B >= ceiling - 2.00`
   - `maxGainToCeiling = ceiling !== null ? Math.max(0, round2(ceiling - B)) : 0`

### 4.3 Stated Model Assumptions (Displayed in UI)

1. **Sequential first-beat stopping rule:** Riding assumes the manager locks the **first** remaining game that beats `B` (or settles for the last game of the week if none beat `B`).
2. **Independent full-season draws:** Each remaining game is modelled as an independent draw from the player's logged season distribution.
3. **Per-starter evaluation:** Each starter's EV is computed independently; week matchup margin is shown alongside for context.

### 4.4 Worked Examples (Required Unit Tests in Phase 3b)

1. **Kessler (`2441`), Leg 3, Sat Nov 7 — `B = 38.00` (unlocked, Nov 6 vs POR), `n = 1` game left (`@DET` Nov 8):**
   - Distribution (10 games): `42.75, 62.50, 12.75, 28.00, 32.75, 45.25, 48.25, 43.75, 46.00, 38.00` (sum = `400.00`).
   - `beatingGames` (`> 38.00`): 6 of 10 (`beatRate = 0.60`) — margins `+4.75, +24.50, +7.25, +10.25, +5.75, +8.00` (sum `60.50`) → `meanUpside = round2(60.50 / 6) = 10.08`.
   - `nonBeatingGames` (`<= 38.00`): 4 of 10 (`12.75, 28.00, 32.75, 38.00`) — shortfalls `25.25, 10.00, 5.25, 0.00` (sum `40.50`) → `meanShortfall = round2(40.50 / 4) = 10.13`.
   - `pAnyBeat` ($n = 1$) = `0.60`.
   - `rideEV` = `round2(0.60 * (60.50 / 6) - 0.40 * (40.50 / 4)) = round2(6.05 - 4.05) = +2.00` → **`RIDE`** (`rideEV > 0` and `pAnyBeat >= 0.5`).

2. **Avdija (`2181`), Leg 3, before Nov 6 game — `B = 46.75` (after Nov 4), `n = 1` game left (`vs LAL` Nov 6):**
   - Distribution through Nov 4 (7 games): `42.50, 43.75, 41.50, 48.75, 33.25, 37.25, 46.75`.
   - `beatingGames` (`> 46.75`): 1 of 7 (`beatRate = 1/7 ≈ 14.3%`) — margin `+2.00` → `meanUpside = 2.00`.
   - `nonBeatingGames` (`<= 46.75`): 6 of 7 — shortfalls `4.25, 3.00, 5.25, 13.50, 9.50, 0.00` (sum `35.50`) → `meanShortfall = round2(35.50 / 6) = 5.92`.
   - `rideEV` = `round2((1/7) * 2.00 - (6/7) * (35.50 / 6)) = round2(2.00/7 - 35.50/7) = round2(-33.50/7) = -4.79` → **`LOCK`**.

---

## 5. Weekly Matchup View (`src/ui/`)

- **Totals:**
  - `userTotal`: sum of `B ?? 0` across the 9 `starters` in `WeekRecord`.
  - `opponentTotal`: initialized from `WeekRecord.opponentPoints` (offline-first, zero network requirement), with a manual numeric input override in the UI so the user can test or update live opponent scores at any time.
  - `margin = round2(userTotal - opponentTotal)`.
- **Remaining Games:** Count of starters with `remainingGames.length > 0` and total starter games remaining in the leg.
- **User Best/Worst-Case Bounds (Bounds Only, Never Predictions):**
  - If a starter is **locked** (`lock !== null`) OR has **`n === 0` remaining games** with `B !== null`:
    - `starterBestCase = B`
    - `starterWorstCase = B`
  - If a starter is **unlocked** and has **`n > 0` remaining games**:
    - `starterBestCase = Math.max(B ?? 0, ceiling ?? 0)`
    - `starterWorstCase = floor ?? B ?? 0`
  - Opponent bounds are omitted (only opponent current total, snapshot timestamp, and optional player score list are shown; no opponent distributions are invented).

---

## 6. Bench Swing (`src/advisor/` + `src/ui/`)

Starter slots follow Beltline Ballers' 9-slot order:
`["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"]`.

A player with `positions: Position[]` is eligible for a slot `S` if:
- `S === "UTIL"`, or
- `S === "G"` and `positions` contains `"PG"` or `"SG"`, or
- `S === "F"` and `positions` contains `"SF"` or `"PF"`, or
- `positions` contains `S`.

For each bench player with a current leg score `benchValue` (`lockedTotal` if locked, else latest completed game total in the leg) and each starter slot `i` (`0..8`) for which the bench player is eligible:
- `swing = round2(benchValue - (starterBanked ?? 0))`
- Include recommendations where `swing > 0`, sorted descending by `swing`.
- Each recommendation reports: bench player, `benchValue` (and bench `rideEV` separately if the bench player has remaining games), starter slot (`PG`, `UTIL`, etc.), current starter in that slot, `starterBanked`, `swing`, and `starterLocked: boolean` (flagged clearly if the starter being replaced has an active lock).

---

## 7. App Views (`src/ui/`)

1. **Top-Level Navigation (`App.tsx`):** View switcher between **Roster**, **Lock Advisor**, and **Matchup** (plus drill-down to **Player Detail** from Roster or Advisor).
2. **Lock Advisor View:** Table/cards for all 9 starters in the selected leg showing slot, player, banked score `B` (+ game date/opponent + `LOCKED` / `UNLOCKED` badge), remaining games `n` (+ dates), `beatRate`, `pAnyBeat`, `meanUpside`, `meanShortfall`, `rideEV`, and recommendation badge (`LOCK`, `RIDE`, `LEAN RIDE`, `LOCKED`, or `FINAL`), plus the model assumptions note.
3. **Matchup View:** Scoreboard card (`Beltline Ballers` vs. `opponentName`, margin, user best/worst-case bounds, remaining starter games, editable opponent total), opponent player breakdown (when present in `weeks.json`), and the **Bench Swing** table.
4. **Player Detail View Enhancement:** When the player has a banked score `B` in the active leg, Target Score Explorer highlights/includes a `Banked (B)` quick-select chip.
