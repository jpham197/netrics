# Netrics — Canonical Design Specification (FROZEN)

**Status:** FROZEN — Consolidates Phase 0–2 (`v1.0`), Phase 3 (`PHASE3-v1.0`), and Phase 4 (`PHASE4-v1.0`). Reviewed by Gemini (`docs/reviews/2026-11-07-gemini-blind-review.md`, `docs/reviews/2026-11-07-gemini-phase3-review.md`, `docs/reviews/2026-11-07-gemini-phase4-review.md`).
**Date:** 2026-11-07
**Authors:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)
**Repo:** `jpham197/netrics` (Vite + React + TypeScript, GitHub Pages via GitHub Actions)
**League:** Sleeper NBA Lock-In Redraft, "Beltline Ballers", `league_id`: `1358656481750171649`

---

## 1. Problem & Scope

The user plays a Sleeper NBA Lock-In redraft league (**Beltline Ballers**). Each week he must decide:
1. **Per player:** What is this player's game-by-game score distribution, ceiling, empirical beat-rate against any target score, and what stat categories drive his spikes?
2. **Lock or ride?** A starter has a score banked from an earlier game this week and `n` games left in the leg. Should the manager lock the banked score or let it ride?
3. **Am I winning the week?** What is the user's current week total vs. the opponent's, with games still to play and best/worst-case bounds?
4. **Is a bench swap worth it?** Would swapping a bench player into an eligible starter slot gain points this week?

Core criterion: **spikes, not averages.** Season averages and projections represent the middle of the range, never a player's ceiling or a lock target. All evaluations are grounded strictly in each player's own game-by-game distribution with transparent math.

---

## 2. Verified League & Lock Mechanics

Fetched from the Sleeper API on `2026-11-07` and cross-checked against `data/game-logs.json` (118 verified game logs).

- **League:** Beltline Ballers, 12 teams, season `2026` (2026–27 NBA season), `in_season`, Week 3 / Leg 3, season started `2026-10-20`.
- **Owner:** `jiph`, `owner_id`: `1266488859059830784`, `roster_id`: `1`.
- **Roster positions:** `PG, SG, G, SF, PF, F, C, UTIL, UTIL, BN x5` (9 starters + up to 6 bench + up to 2 reserve/IR).
- **Legs run Monday–Sunday:** Leg 1 = Tue `2026-10-20` – Sun `2026-10-25`, Leg 2 = `2026-10-26` – `2026-11-01`, Leg 3 = `2026-11-02` – `2026-11-08`.

### 2.1 Scoring Settings (`scoring_settings`, exact from Sleeper)

| Category | Sleeper Key | Points |
|---|---|---|
| Points | `pts` | `+1.0` |
| Rebound | `reb` | `+1.25` |
| Assist | `ast` | `+1.5` |
| Steal | `stl` | `+3.0` |
| Block | `blk` | `+3.0` |
| Turnover | `tov` (`to`) | `-1.0` |
| Double-double | `dd` | `+2.0` |
| Triple-double | `td` | `+3.0` |
| Technical foul | `tf` | `-2.0` |
| Flagrant foul | `ff` | `-2.0` |
| 40+ points bonus | `bonus_pt_40p` | `+1.0` |
| 50+ points bonus | `bonus_pt_50p` | `+1.0` |
| 15+ assists bonus | `bonus_ast_15p` | `+1.0` |
| 20+ rebounds bonus | `bonus_reb_20p` | `+1.0` |
| Three-pointers made | `tpm` | `0.0` (unscored) |

### 2.2 Roster Snapshot (`asOf: "2026-11-07"`)

| Sleeper ID | Player | Team | Pos | Status (`2026-11-07`) |
|---|---|---|---|---|
| `2267` | Cade Cunningham | DET | PG | `starter` |
| `2181` | Deni Avdija | POR | PF | `starter` |
| `4750` | Jeremiah Fears | NOP | PG | `starter` |
| `1752` | Lauri Markkanen | UTA | PF | `starter` |
| `1739` | Domantas Sabonis | SAC | C | `starter` |
| `2714` | Kyshawn George | WAS | SF | `starter` |
| `2441` | Walker Kessler | LAL | C | `starter` |
| `4737` | VJ Edgecombe | PHI | SG | `starter` |
| `2713` | Jared McCain | OKC | SG | `starter` |
| `1074` | Paul George | BOS | SF | `bench` |
| `2131` | Saddiq Bey | NOP | SF | `bench` |
| `1998` | Coby White | CHA | PG | `bench` |
| `2583` | Jaime Jaquez Jr. | MIL | PF | `bench` |
| `4742` | Nolan Traore | BKN | PG | `bench` |
| `2456` | Keegan Murray | SAC | PF | `reserve` |

### 2.3 How Sleeper Scores a Lock-In Week

For each rostered player, Sleeper's week score (`players_points` in `GET /league/{id}/matchups/{leg}`, and the matching slot in `starters_points`) is:
- **the locked score, if the manager locked that player during that leg;**
- **otherwise, the player's most recent completed game of that leg.**

A locked score freezes even if the player plays again later in the leg, and even if the player is later moved to the bench. Because Sleeper exposes no lock endpoint and live `players_points` can lag lock actions, **Netrics never infers locks from Sleeper's live scores.** A player is treated as locked if and only if a `LockRecord` exists in `data/locks.json` (see `docs/decisions/0002-phase3-lock-record-and-advisor-ev.md`).

### 2.4 Verified Leg 3 Reconciliation (`2026-11-02` – `2026-11-08`)

All 9 starters and bench players reconcile 100% against `data/game-logs.json`:

| Player | Sleeper leg-3 score | Seed logs this leg | Verdict |
|---|---:|---|---|
| Cade (`2267`) | `61.75` | Nov 2 `61.75`, Nov 4 `58.25` | Locked at Nov 2 (user-confirmed) |
| Avdija (`2181`) | `46.75` | Nov 2 `37.25`, Nov 4 `46.75`, Nov 6 `49.75` | Locked at Nov 4 (user-confirmed) |
| Fears (`4750`) | `41.75` | Nov 2 `23.50`, Nov 4 `33.50`, Nov 6 `41.75` | Locked at Nov 6 (user-confirmed) |
| Markkanen (`1752`) | `47.50` | Nov 2 `39.50`, Nov 4 `47.50`, Nov 6 `33.50` | Locked at Nov 4 (user-confirmed) |
| Sabonis (`1739`) | `35.50` | Nov 2 `22.75`, Nov 4 `41.75`, Nov 6 `35.50` (`ff: 1`) | Most recent ✓ (unlocked; Nov 6 includes Flagrant 1 foul `-2.00`) |
| Kyshawn (`2714`) | `57.00` | Nov 2 `39.50`, Nov 4 `36.50`, Nov 6 `57.00` (`8 ast`) | Most recent ✓ (unlocked) |
| Kessler (`2441`) | `38.00` | Nov 2 `43.75`, Nov 4 `46.00`, Nov 6 `38.00` | Most recent ✓ (unlocked; user declined to lock `46.00`) |
| Edgecombe (`4737`) | `37.75` | Nov 2 `37.25`, Nov 4 `23.00`, Nov 6 `37.75` | Most recent ✓ (unlocked) |
| McCain (`2713`) | `41.25` | Nov 2 `20.25`, Nov 4 `11.25`, Nov 6 `41.25` | Most recent ✓ (unlocked) |
| Paul George (`1074`, bench) | `42.25` | Nov 4 `42.25`, Nov 6 `21.75` | Locked at Nov 4 — lock persists on the bench |
| Bey (`2131`, bench) | `31.25` | Nov 2 `28.75`, Nov 4 `33.50`, Nov 6 `31.25` | Most recent ✓ (unlocked) |

User Leg 3 total across the 9 starters: `61.75 + 46.75 + 41.75 + 47.50 + 35.50 + 57.00 + 38.00 + 37.75 + 41.25 = 407.25`. Opponent (`roster_id: 8`, `notNoah224`) total as of snapshot: `317.25` (margin `+90.00`).

---

## 3. Scoring Engine — Pure & Deterministic (`src/scoring/`)

One pure function (`fantasyPoints(g: GameLog)`) with zero UI or network dependencies.

```ts
export interface ScoreBreakdown {
  scoring: number;     // pts * 1.0
  rebounds: number;    // reb * 1.25
  playmaking: number;  // ast * 1.5
  stocks: number;      // (stl + blk) * 3.0
  bonuses: number;     // dd(2) + td(3) + pts40(1) + pts50(1) + ast15(1) + reb20(1)
  penalties: number;   // -(tov * 1.0 + tf * 2.0 + ff * 2.0) (<= 0)
}

export interface FantasyScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
  isDoubleDouble: boolean;
  isTripleDouble: boolean;
}
```

### Exact Formula & Rules
Let `tf = g.tf ?? 0` and `ff = g.ff ?? 0`.
1. **Double-Double & Triple-Double Derivation:**
   - Count how many of the 5 positive categories `[g.pts, g.reb, g.ast, g.stl, g.blk]` are `>= 10` (turnovers never count).
   - `isDoubleDouble = count >= 2`
   - `isTripleDouble = count >= 3`
2. **Stacking Rules:**
   - **Triple-double stacks with Double-double:** A triple-double satisfies both `count >= 2` (`+2.0`) and `count >= 3` (`+3.0`), earning **+5.0 total** from DD+TD bonuses.
   - **Milestone bonuses stack:** A 50-point game satisfies both `pts >= 40` (`+1.0`) and `pts >= 50` (`+1.0`), earning **+2.0 total** from scoring milestone bonuses.
3. **6-Part Additive Breakdown:**
   - `scoring = g.pts * 1.0`
   - `rebounds = g.reb * 1.25`
   - `playmaking = g.ast * 1.5`
   - `stocks = (g.stl + g.blk) * 3.0`
   - `bonuses = (isDoubleDouble ? 2 : 0) + (isTripleDouble ? 3 : 0) + (g.pts >= 40 ? 1 : 0) + (g.pts >= 50 ? 1 : 0) + (g.ast >= 15 ? 1 : 0) + (g.reb >= 20 ? 1 : 0)`
   - `penalties = -(g.tov * 1.0 + tf * 2.0 + ff * 2.0)`
   - `total = round2(scoring + rebounds + playmaking + stocks + bonuses + penalties)`
   - Invariant: `scoring + rebounds + playmaking + stocks + bonuses + penalties === total`.

### Worked Examples (Unit Tests in `src/scoring/scoring.test.ts`)
- **Avdija, 2026-11-06 `@LAL`:** `22 pts, 9 reb, 11 ast, 2 stl, 0 blk, 8 tov` (DD: pts, ast) → `22.00 + 11.25 + 16.50 + 6.00 + 2.00 - 8.00 = 49.75`
- **Markkanen, 2026-11-04 `@NOP`:** `21 pts, 10 reb, 4 ast, 1 stl, 2 blk, 3 tov` (DD: pts, reb) → `21.00 + 12.50 + 6.00 + 9.00 + 2.00 - 3.00 = 47.50`
- **Kessler, 2026-11-04 `@SAC`:** `15 pts, 8 reb, 0 ast, 3 stl, 4 blk, 0 tov` (no DD) → `15.00 + 10.00 + 0.00 + 21.00 + 0.00 - 0.00 = 46.00`
- **Fears, 2026-11-06 `MIN`:** `24 pts, 5 reb, 5 ast, 2 stl, 0 blk, 2 tov` → `24.00 + 6.25 + 7.50 + 6.00 + 0.00 - 2.00 = 41.75`
- **McCain, 2026-11-06 `@MEM`:** `21 pts, 5 reb, 0 ast, 4 stl, 1 blk, 1 tov` → `21.00 + 6.25 + 0.00 + 15.00 + 0.00 - 1.00 = 41.25`
- **Sabonis, 2026-11-06 `SAS`:** `17 pts, 13 reb, 5 ast, 0 stl, 1 blk, 5 tov, 1 ff` (DD: pts, reb; Flagrant 1) → `17.00 + 16.25 + 7.50 + 3.00 + 2.00 - 7.00 = 35.50`

---

## 4. Data Model & Validation Invariants (`src/data/` + `data/`)

Netrics stores four validated JSON files under `data/`: `players.json`, `game-logs.json`, `weeks.json`, and `locks.json`.

```ts
export const LEAGUE_ID = "1358656481750171649";
export const STARTER_SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"] as const;
export type StarterSlot = (typeof STARTER_SLOTS)[number];
export type RosterStatus = "starter" | "bench" | "reserve";

export interface Player {
  sleeperId: string;           // Canonical primary key, never player name
  name: string;
  team: string;                // Verified 3-letter NBA team code
  positions: string[];         // e.g. ["PF"]
  rosterStatus: RosterStatus;  // Snapshot status as of PlayersFile.asOf
}

export interface PlayersFile {
  asOf: string;                // YYYY-MM-DD snapshot date
  leagueId: string;
  players: Player[];
}

export interface GameLog {
  sleeperId: string;           // Foreign key -> Player.sleeperId
  date: string;                // YYYY-MM-DD (America/New_York game date)
  opponent: string;            // "OPP" (home) or "@OPP" (away)
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  tf?: number;                 // Defaults to 0
  ff?: number;                 // Defaults to 0
  source: string;              // Non-empty provenance string
  expectedTotal?: number;      // Optional validation-only cross-check; NEVER read by UI/analytics
}

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
  matchupId: number;                      // Sleeper matchup_id
  opponentRosterId: number;               // Sleeper roster_id of opponent
  opponentName: string;                   // Sleeper username, e.g. "notNoah224"
  opponentPoints: number;                 // Snapshot of opponent's week total
  opponentAsOf: string;                   // ISO date/timestamp of opponent snapshot
  opponentRemainingGames?: number;
  opponentPlayers?: OpponentPlayerScore[];
  starters: string[];                     // 9 sleeperIds in STARTER_SLOTS order
  bench: string[];                        // Up to 6 bench sleeperIds
  reserve: string[];                      // Up to 2 reserve/IR sleeperIds
  remainingGames: Record<string, string[]>; // Unplayed leg game dates per sleeperId
}

export interface WeeksFile {
  leagueId: string;
  weeks: WeekRecord[];
}

export type LockSource = "user" | "sleeper-verified";

export interface LockRecord {
  sleeperId: string;                      // Foreign key -> Player.sleeperId
  leg: number;                            // Must exist in weeks.json
  gameDate: string;                       // YYYY-MM-DD of locked game (must exist in game-logs.json)
  lockedTotal: number;                    // Must equal fantasyPoints(log).total
  lockedAt: string;                       // ISO 8601 timestamp or ""
  source: LockSource;
  note?: string;
}

export interface LocksFile {
  leagueId: string;
  locks: LockRecord[];
}
```

### Data Invariants Enforced by `npm run validate` (`src/data/validate.ts`)
1. **Players & Game Logs:**
   - Complete non-negative integer box scores (`pts, reb, ast, stl, blk, tov`, plus optional `tf, ff`).
   - Unique `(sleeperId, date)` per `GameLog`, valid calendar dates, valid NBA opponent codes (`"OPP"` or `"@OPP"`), no self-opponents, and cross-player schedule/home-away symmetry on shared dates.
   - Mandatory non-empty `source` string on every `GameLog`.
   - When `expectedTotal` is present on a `GameLog`, `fantasyPoints(log).total === log.expectedTotal`.
2. **Weeks (`weeks.json`):**
   - `startDate <= endDate`, `starters.length === 9` (with each starter position-eligible for its slot in `STARTER_SLOTS`), `bench.length <= 6`, `reserve.length <= 2`, and no duplicate player across `starters`, `bench`, and `reserve`.
   - Every rostered player in the week has an entry in `remainingGames`, and every key in `remainingGames` exists in `players.json`.
   - Every date in `remainingGames[sleeperId]` is in ascending order, falls within `[startDate, endDate]`, and does not already exist as a played `(sleeperId, date)` in `game-logs.json`.
   - Active (non-`reserve`) teammates on the same NBA team have identical `remainingGames` schedules in that week.
3. **Locks (`locks.json`):**
   - At most one `LockRecord` per `(sleeperId, leg)`.
   - `leg` exists in `weeks.json`, and `week.startDate <= gameDate <= week.endDate`.
   - Matching `(sleeperId, gameDate)` exists in `game-logs.json`, and `lockedTotal === fantasyPoints(log).total`.

---

## 5. Per-Player Analytics (`src/analytics/`)

1. **Distribution:** Scored game logs sorted descending by `total` (with chronological sort toggle in the UI), carrying `date`, `opponent`, raw stat line, `total`, and 6-part `breakdown`.
2. **Summary Stats:** `gamesPlayed` (`GP`), `ceiling` (max), `floor` (min), `median`, `lastGame` (latest `date`), and `mean` (labelled `Mean (ref only)` in Player Detail; never shown on Roster or used as a target).
3. **Target Score Evaluation (`evaluateTarget`):**
   - `beatingGames`: games with `game.total > target` (strict `>`), sorted high → low, with `margin = round2(game.total - target)`.
   - `beatCount = beatingGames.length`, `beatRate = gamesPlayed > 0 ? beatCount / gamesPlayed : 0`.
   - `maxUpside = Math.max(0, round2(ceiling - target))`, `maxDownside = Math.max(0, round2(target - floor))`.
4. **Spike Drivers:** Top 3 positive games (`total > 0`) by `total` are flagged `isSpike: true` and tagged with their dominant category (`stocks`, `playmaking`, `rebounds`, or `scoring`).
5. **Five-Number Summary (`src/analytics/boxplot.ts`):**
   - Given a player's windowed fantasy totals sorted ascending `x[0..N-1]`:
     - Returns `null` when `N === 0`.
     - `min = round2(x[0])`, `max = round2(x[N - 1])`.
     - Quartiles (`p` in `{0.25, 0.50, 0.75}`) use linear interpolation (`QUARTILE.INC` / NumPy default): `h = p * (N - 1)`, `lo = Math.floor(h)`, `frac = h - lo`, `raw = lo + 1 < N ? x[lo] + frac * (x[lo + 1] - x[lo]) : x[lo]`, rounded with `round2`.
     - `median` (`p = 0.50`) matches `summarize().median` for every `N`.
     - `iqr = round2(q3 - q1)` (computed from the `round2` `q1` and `q3` values so the displayed `Q3 - Q1 === IQR` always holds).
     - Whiskers extend to `min` and `max` (no `1.5 * IQR` outlier rule).
   - **Worked Examples (Required Unit Tests in `src/analytics/boxplot.test.ts`):**
     - **Kessler (`2441`), All Season (`N = 10`):** sorted `[12.75, 28.00, 32.75, 38.00, 42.75, 43.75, 45.25, 46.00, 48.25, 62.50]` → `min = 12.75, q1 = 34.06, median = 43.25, q3 = 45.81, max = 62.50, iqr = 11.75`.
     - **Kessler (`2441`), `last-week` at `asOf 2026-11-07` (`[2026-10-31, 2026-11-07]`, `N = 4`):** sorted `[38.00, 43.75, 46.00, 48.25]` → `min = 38.00, q1 = 42.31, median = 44.88, q3 = 46.56, max = 48.25, iqr = 4.25`.
     - **Small-`N`:** `[10, 20, 30]` (`N = 3`) → `min = 10.00, q1 = 15.00, median = 20.00, q3 = 25.00, max = 30.00, iqr = 10.00`; `N = 1` → all five numbers equal that game's total and `iqr = 0.00`; `N = 0` → `null`.
6. **Time Windows (`src/analytics/windows.ts`):**
   - Trailing calendar-day ranges anchored at `PlayersFile.asOf` (inclusive on both ends: `startDate <= log.date <= asOf`), computed in UTC date arithmetic on `YYYY-MM-DD` strings:
     - `"last-week"` (`Last week`, `days: 7`): `[asOf - 6 days, asOf]`
     - `"last-3-weeks"` (`Last 3 weeks`, `days: 21`): `[asOf - 20 days, asOf]`
     - `"last-month"` (`Last month`, `days: 30`): `[asOf - 29 days, asOf]`
     - `"all"` (`All season`, `days: null`): all logged games (no date filter, default).
   - Exports `TIME_WINDOWS`, `windowStartDate(asOf, days)`, `filterLogsByWindow(logs, window, asOf)`, and `filterGamesByWindow(games, window, asOf)`.

---

## 6. Lock Advisor, Weekly Matchup & Bench Swing Engine (`src/advisor/`)

### 6.1 Lock Advisor Math Contract (`evaluateLockDecision`)
Given a player's full season scored `distribution` (`N = distribution.length`), current leg games `legGames`, optional `lock: LockRecord | null`, and `n = remainingGameDates.length`:

1. **Banked Score (`B`):**
   - If `lock !== null`, `B = lock.lockedTotal` (from `lock.gameDate`).
   - Else if `legGames.length > 0`, `B = latestLegGame.total` (greatest `date` in `legGames`).
   - Else `B = null`.
2. **Conditional Distribution Metrics (for numeric `B` when `N > 0`):**
   - `beatingGames`: games in `distribution` with `g.total > B` (strict `>`).
   - `nonBeatingGames`: games in `distribution` with `g.total <= B` (includes ties `g.total === B` with `0` shortfall).
   - `beatRate = beatingGames.length / N`.
   - `meanUpsideRaw = beatingGames.length > 0 ? sum(g.total - B) / beatingGames.length : 0`, `meanUpside = round2(meanUpsideRaw)`.
   - `meanShortfallRaw = nonBeatingGames.length > 0 ? sum(B - g.total) / nonBeatingGames.length : 0`, `meanShortfall = round2(meanShortfallRaw)`.
3. **Multi-Game Sequential Stopping Probability & Expected Value (`n` remaining games):**
   - Under the sequential strategy **"Ride and lock the FIRST remaining game that strictly beats `B`, or take the final remaining game of the week if none beat `B`"**:
   - Let `hasActiveDraws = lock === null && B !== null && N > 0 && n > 0`.
   - `pAnyBeat = hasActiveDraws ? 1 - Math.pow(1 - beatRate, n) : 0`
   - `rideEV = hasActiveDraws ? round2(pAnyBeat * meanUpsideRaw - (1 - pAnyBeat) * meanShortfallRaw) : 0`
   - For $n = 1$, `rideEV(B, 1)` equals `round2(mean(distribution) - B)`.
4. **Status & Recommendation Rules:**
   - `lock !== null` → `status = "LOCKED"`, `recommendation = null`, `lockGainVsLatest = latestLegGame ? round2(lock.lockedTotal - latestLegGame.total) : 0`.
   - `B === null || N === 0` → `status = "NO_BANKED_SCORE"`, `recommendation = null`.
   - `n === 0` → `status = "NO_GAMES_LEFT"`, `recommendation = null`.
   - Otherwise → `status = "DECISION"`, `recommendation = rideEV <= 0 ? "LOCK" : pAnyBeat >= 0.5 ? "RIDE" : "LEAN_RIDE"`.

### 6.2 Worked Examples (Unit Tests in `src/advisor/advisor.test.ts`)
1. **Kessler (`2441`), Leg 3, Sat Nov 7 — `B = 38.00` (unlocked, Nov 6 vs POR), `n = 1` (`@DET` Nov 8):**
   - `beatingGames` (`> 38.00`): 6 of 10 (`beatRate = 0.60`), `meanUpside = round2(60.50 / 6) = 10.08`.
   - `nonBeatingGames` (`<= 38.00`): 4 of 10 (`12.75, 28.00, 32.75, 38.00`), `meanShortfall = round2(40.50 / 4) = 10.13`.
   - `rideEV = round2(0.60 * (60.50 / 6) - 0.40 * (40.50 / 4)) = +2.00` → **`RIDE`**.
2. **Avdija (`2181`), Leg 3 before Nov 6 game — `B = 46.75` (after Nov 4), `n = 1` (`@LAL` Nov 6, 7 games through Nov 4):**
   - `beatingGames` (`> 46.75`): 1 of 7 (`beatRate = 1/7`), `meanUpside = 2.00`.
   - `nonBeatingGames` (`<= 46.75`): 6 of 7, `meanShortfall = round2(35.50 / 6) = 5.92`.
   - `rideEV = round2((1/7) * 2.00 - (6/7) * (35.50 / 6)) = -4.79` → **`LOCK`**.

### 6.3 Weekly Matchup & Bounds (`evaluateMatchup`)
- `userTotal`: sum of `B ?? 0` across the 9 `starters` in `WeekRecord`.
- `opponentTotal`: initialized from `WeekRecord.opponentPoints`, with a manual numeric override in the UI.
- `margin = round2(userTotal - opponentTotal)`.
- **Starter Best/Worst-Case Bounds:**
  - If locked (`lock !== null`) OR `n === 0` with `B !== null`: `bestCase = B`, `worstCase = B`.
  - If unlocked and `n > 0`: `bestCase = Math.max(B ?? 0, ceiling ?? 0)`, `worstCase = floor ?? B ?? 0`.

### 6.4 Bench Swing (`evaluateBenchSwings`)
- Slot order: `["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"]`.
- Eligibility: `"UTIL"` accepts any position; `"G"` accepts `"PG"` or `"SG"`; `"F"` accepts `"SF"` or `"PF"`; exact slot matches itself.
- For each bench player with `benchValue !== null` and each eligible starter slot `i`, `swing = round2(benchValue - (starterBanked ?? 0))`. Positive swings (`swing > 0`) are returned sorted descending by `swing`, flagging `starterLocked: boolean`.

---

## 7. App Views (`src/ui/`)

1. **Top-Level Navigation (`App.tsx`):** Tab switcher between **Roster**, **Lock Advisor**, and **Matchup**, with drill-down to **Player Detail** from any view.
2. **Roster View (`RosterView.tsx`):** Grouped into `Starters`, `Bench`, and `Reserve / IR`, sortable by **Ceiling**, **Median**, or **Last Game** (always full-season).
3. **Lock Advisor View (`LockAdvisorView.tsx`):** All 9 starters in slot order showing slot, player, banked score `B` (`LOCKED` / `UNLOCKED` badge + `lockGainVsLatest`), remaining games `n` (+ dates), `beatRate`, `pAnyBeat`, `meanUpside`, `meanShortfall`, `rideEV`, recommendation badge, and the stated model assumptions note.
4. **Matchup View (`MatchupView.tsx`):** Scoreboard (`Beltline Ballers` vs `opponentName`, margin, user best/worst-case bounds, remaining starter games with unlocked count, editable opponent total), **Bench Swing** table, and starter breakdown.
5. **Player Detail View (`PlayerDetail.tsx`) & Box Plot (`BoxPlot.tsx`):**
   - **Time-Window Selector:** 4 chips (`Last week`, `Last 3 weeks`, `Last month`, `All season`, default `All season`) above the summary cards, anchored at `PlayersFile.asOf`. Filtering applies to the entire Player Detail view (summary cards, Box Plot, Target Score Explorer, and game-by-game list), with the active window label shown in the header subtitle; switching windows resets the Target Score Explorer's initial target to the windowed `lastGame.total`.
   - **Summary Cards:** `Ceiling`, `Median`, `Floor`, `Last Game`, `GP`, and secondary `Mean (ref only)` for the selected window.
   - **Box Plot (`src/ui/BoxPlot.tsx`):** Hand-drawn horizontal SVG between the summary cards and Target Score Explorer:
     - Scale from windowed `min` to `max` padded by 5% on each side (or `[min - 1, max + 1]` when `min === max`).
     - Draws the `Q1–Q3` box, median line, and `min`/`max` whiskers when `N >= 3`, plus one dot per game in the window (spike games styled with spike color). When `N` is 1–2, plots the individual game dots on the scale with the note `"Not enough games for a box plot — showing individual games."`
     - **Banked-Score Marker:** When `bankedScore !== null`, draws a vertical `Banked (B)` marker line if `min <= B <= max`, or displays a text note when `B` is outside the windowed `[min, max]` range.
     - **Accessible Readout:** Displays `Min / Q1 / Median / Q3 / Max / IQR` (`round2`) below the SVG.
   - **Target Score Explorer:** Interactive target input, `Banked (B)` quick-select chip, and game score chips for the selected window.
   - **Game-by-Game Distribution:** Visual bar + 6-part breakdown per game in the selected window.
