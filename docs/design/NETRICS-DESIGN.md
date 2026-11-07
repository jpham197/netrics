# Netrics — Canonical Design Specification (FROZEN)

**Status:** FROZEN — Consolidates Phase 0–2 (`v1.0`), Phase 3 (`PHASE3-v1.0`), Phase 4 (`PHASE4-v1.0`), Phase 5 (`PHASE5-v1.0`), Phase 6 (`PHASE6-v1.0`), and Phase 6c (`PHASE6C-v1.0`). Reviewed by Gemini (`docs/reviews/2026-11-07-gemini-blind-review.md`, `docs/reviews/2026-11-07-gemini-phase3-review.md`, `docs/reviews/2026-11-07-gemini-phase4-review.md`, `docs/reviews/2026-11-07-gemini-phase5-review.md`, `docs/reviews/2026-11-07-gemini-phase6-review.md`, `docs/reviews/2026-11-07-gemini-phase6c-review.md`).
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

Netrics stores five validated JSON files under `data/`: `players.json`, `game-logs.json`, `weeks.json`, `locks.json`, and `espn-player-map.json`.

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

export interface EspnPlayerMapEntry {
  sleeperId: string;                      // Foreign key -> Player.sleeperId
  espnAthleteId: string;                  // Numeric ESPN athlete ID string, e.g. "5174563"
  name: string;                           // Display name, for human review
  espnTeam: string;                       // Canonical 3-letter NBA team code (or ESPN team code normalized via normalizeEspnTeam)
}

export interface EspnPlayerMapFile {
  leagueId: string;
  players: EspnPlayerMapEntry[];
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
4. **ESPN Player Map (`espn-player-map.json`):**
   - `leagueId === LEAGUE_ID`.
   - Exact 1-to-1 coverage with `players.json`: every `Player.sleeperId` in `players.json` has exactly one `EspnPlayerMapEntry`, and every `EspnPlayerMapEntry.sleeperId` exists in `players.json` (no missing or extra players, no duplicate `sleeperId`).
   - Every `espnAthleteId` is a non-empty numeric string (`/^\d+$/`) and unique across all entries.
   - Every `espnTeam` (after `normalizeEspnTeam`) is a valid 3-letter NBA team in `VALID_NBA_TEAMS` and `name` is non-empty.

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
4. **Matchup View (`MatchupView.tsx`):** Scoreboard (`Beltline Ballers` vs `opponentName`, margin, user best/worst-case bounds, remaining starter games with unlocked count, editable opponent total), live Sleeper scoreboard status + manual `Refresh` button (§8.2), **Bench Swing** table, starter breakdown, and opponent breakdown.
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

---

## 8. Live Sleeper Data Integration (`src/sleeper/`)

### 8.1 Verified Sleeper API Inventory (`https://api.sleeper.app/v1`, public, CORS `*`)
- `GET /v1/state/nba` — returns `{ week, leg, season, season_start_date, season_has_scores }` (used in 5b).
- `GET /v1/league/{id}/matchups/{leg}` — returns 12 roster matchup objects `{ roster_id, matchup_id, points, starters, starters_points, players_points }` (used in 5a and 5b).
- `GET /v1/league/{id}/rosters` — returns 12 roster objects `{ roster_id, players, starters, reserve, settings }` (used in 5b).
- `GET /v1/league/{id}/transactions/{leg}` — returns add/drop/trade transactions for the leg (used in 5b).
- `GET /v1/players/nba` — 2,176-player dictionary (~2.5 MB) with `full_name, team, position, status, injury_status` (used in 5b CLI only; never fetched in the browser).
- **Forbidden / Unavailable Endpoints:**
  - `GET /v1/stats/nba/regular/{week}` returns empty `{}` objects for all 1,852 NBA players and **must never be called**.
  - Sleeper provides no per-game NBA box-score endpoint, no NBA schedule endpoint, and no lock endpoint; `data/game-logs.json`, `WeekRecord.remainingGames`, and `data/locks.json` remain manually curated and validated.

### 8.2 Stage 5a — Runtime Live Matchup (`src/sleeper/liveMatchup.ts` + `src/ui/MatchupView.tsx`)
```ts
export const LIVE_MATCHUP_COOLDOWN_MS = 15_000;

export interface LiveStarterScore {
  sleeperId: string;
  points: number;
}

export interface LiveMatchup {
  leg: number;
  matchupId: number;
  fetchedAt: string;                  // ISO timestamp of fetch
  userPoints: number;                 // roster_id 1 `points` from matchups/{leg} (round2)
  opponentRosterId: number;
  opponentPoints: number;             // opponent roster `points` (round2)
  opponentStarters: LiveStarterScore[]; // opponent `starters` paired with `players_points`/`starters_points`
  userStarters: LiveStarterScore[];     // roster 1 `starters` paired with `players_points`/`starters_points`, display only
}

export function parseLiveMatchup(
  payload: unknown,
  leg: number,
  opponentRosterId: number,
  matchupId?: number,
  fetchedAt?: string,
): LiveMatchup;

export async function fetchLiveMatchup(
  leagueId: string,
  leg: number,
  opponentRosterId: number,
  matchupId?: number,
  options?: { force?: boolean; fetchImpl?: typeof fetch; now?: () => number },
): Promise<LiveMatchup>;
```

- **Fetch & Cooldown Rules:**
  - `MatchupView` calls `fetchLiveMatchup(LEAGUE_ID, week.leg, week.opponentRosterId, week.matchupId)` once on mount (or when `week.leg` changes) and exposes a manual `Refresh` button. No background timer polling.
  - `fetchLiveMatchup` caches the most recent successful result per `(leagueId, leg, opponentRosterId)` and returns the cached `LiveMatchup` if called again within `LIVE_MATCHUP_COOLDOWN_MS` (`15_000` ms) unless `resetLiveMatchupCache()` is called in tests.
  - `parseLiveMatchup` validates that `payload` is an array containing `roster_id === 1` and `roster_id === opponentRosterId` (and matching `matchup_id === matchupId` when `matchupId` is provided) with finite numeric `points`; throws a descriptive `Error` on malformed payloads, missing rosters, or non-200 HTTP status.
- **Scoreboard & Override Behavior in `MatchupView`:**
  - **User Total (`Beltline Ballers` card):** Always displays `matchup.userTotal` (computed from verified `locks.json` + `game-logs.json`) as the primary card value. When `live` is available, the card subtitle shows `9 starters · Sleeper live: <fmt(live.userPoints)>`.
  - **Opponent Total & Override:** Defaults to `live.opponentPoints` when `live` is loaded (unless the user has manually edited the `Opponent score override` input), or `week.opponentPoints` when offline/loading. Clicking `Reset` resets the override input to the active baseline (`live.opponentPoints` when live is loaded, else `week.opponentPoints`).
  - **Status Pill:** Shows `Live · fetched <time>` when `live` is active, or `Offline · showing saved scores as of <week.opponentAsOf>` while loading or if the fetch fails. Never renders blank or `0` on fetch failure.
  - **Opponent Breakdown Table:** When `live.opponentStarters.length > 0`, renders the opponent's 9 starters with live points, resolving player `name`, `position`, and `team` from `week.opponentPlayers` by `sleeperId` and falling back to `Player #<sleeperId>` when not present in `week.opponentPlayers`. When offline, renders `week.opponentPlayers` if present.
  - **Locks & Advisor Isolation:** Live Sleeper data is display-only and never mutates `locks.json`, `evaluateLockDecision`, or starter `bankedScore` / best-worst bounds.

### 8.3 Stage 5b — Read-Only Roster & Week Sync CLI (`src/sleeper/syncReport.ts` + `src/sleeper/sync-cli.ts`)
- Invoked manually via `npm run sync:sleeper` (never in CI, never writes `data/*.json`, never auto-commits).
- Pure diff computation in `src/sleeper/syncReport.ts`:
  1. **Leg check:** Compares `state/nba.leg` against the latest `leg` in `data/weeks.json`.
  2. **Roster 1 membership diff:** Compares `rosters` (`roster_id === 1`: `starters`, `players`, `reserve`) against `data/players.json` (`starter`, `bench`, `reserve`) and `WeekRecord` (`starters`, `bench`, `reserve`), annotating any added/dropped players with player metadata (`full_name`, `team`, `position` from `players/nba`) and matching add/drop entries from `transactions/{leg}`.
  3. **Matchup snapshot diff (informational):** Reports whether live `opponentPoints` or `userPoints` from `matchups/{leg}` differ from `WeekRecord.opponentPoints`.
  4. **Exit code:** Returns `hasActionableDiffs: boolean` (`true` when the current leg is missing from `weeks.json` or Roster 1 membership/slots in `players.json` / `weeks.json` differ from Sleeper; informational live point movement alone does not fail the check). The CLI prints the human-readable report and exits with code `1` when `hasActionableDiffs` is `true`, or `0` when in sync.

---

## 9. ESPN Game-Log Ingestion & Sleeper Reconciliation (`src/espn/`)

### 9.1 Verified ESPN Public Endpoints (`https://site.api.espn.com/apis/site/v2/sports/basketball/nba`, public, keyless)
- **Scoreboard:** `GET /scoreboard?dates=YYYYMMDD` — returns `events[]`, where each event provides `id`, `status.type.description` / `status.type.completed` (`"Final"` vs `"Scheduled"` / `"In Progress"`), and `competitions[0].competitors[]` (`homeAway: "home" | "away"`, `team.abbreviation`).
- **Summary (Box Score):** `GET /summary?event={eventId}` — returns `boxscore.players[]`, where each team block has `team.abbreviation` and `statistics[0]` containing column headers `labels` (or `names`, e.g., `["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"]`) and `athletes[]` (`{ athlete: { id, displayName }, didNotPlay?: boolean, reason?: string, stats: string[] }`).
- **Rejected Source (`cdn.nba.com`):** Returns HTTP 403 (Akamai bot protection) and must never be used.

### 9.2 Team Normalization & Header-Driven Box-Score Extraction (`src/espn/ingest.ts`)
1. **Team Code Normalization (`normalizeEspnTeam`):**
   - Normalizes ESPN's non-standard abbreviations to canonical 3-letter NBA codes in `VALID_NBA_TEAMS`:
     - `GS -> GSW`, `NY -> NYK`, `NO -> NOP`, `SA -> SAS`, `UTAH -> UTA`, `WSH -> WAS` (all other 3-letter codes uppercased and verified against `VALID_NBA_TEAMS`).
   - Derives `GameLog.opponent` from the game's home/away competitors using normalized 3-letter codes: `"OPP"` when the player's team is `"home"`, `"@OPP"` when `"away"`.
2. **Header-Driven Stat Lookup & Minutes Threshold (`parseMinutes`):**
   - Resolves column indices dynamically from `statistics[0].labels` (or `names`): `MIN`, `PTS`, `REB`, `AST`, `STL`, `BLK`, and `TO` (or `TOV`).
   - `parseMinutes(raw)` parses integer strings (`"34"` → `34`) or `MM:SS` strings (`"34:12"` → `34 + 12/60`), returning `0` for `""`, `"--"`, `"0"`, or `"0:00"`.
   - Every completed (`Final`) game where a mapped player has `didNotPlay !== true`, `stats.length > 0`, and `parseMinutes(MIN) > 0` produces a candidate `GameLog` (including short appearances that score `0.00`). Players with `didNotPlay === true`, empty `stats`, or `parseMinutes(MIN) <= 0` are recorded as skipped (`reason: "DNP"`).
   - Auto-ingested logs omit `tf` and `ff` (ESPN `PF` is personal fouls total and does not split technical or flagrant fouls), set `expectedTotal: fantasyPoints(log).total`, and set `source`:
     - `"ESPN box score {eventId} {date} {awayTeam} @ {homeTeam} ({pts}/{reb}/{ast}, {stl} stl, {blk} blk, {tov} tov)"` (using canonical 3-letter team codes).

### 9.3 Modes, Sleeper Reconciliation & Safe Output (`src/espn/ingest.ts` + `src/espn/ingest-cli.ts`)
```
npm run ingest:espn -- --date YYYY-MM-DD [--date YYYY-MM-DD ...] [--verify-existing] [--out <path>]
```

1. **Forward Ingestion Mode (default):**
   - Skips any `(sleeperId, date)` already present in `data/game-logs.json` (`reason: "already logged"`).
   - Skips games that are not `"Final"` (`reason: "not Final"`).
2. **Existing-Log Audit Mode (`--verify-existing`):**
   - Instead of skipping already-logged `(sleeperId, date)` entries on the requested date(s), compares each committed `GameLog` against the extracted ESPN box-score line across `opponent, pts, reb, ast, stl, blk, tov`.
   - Records `VERIFIED` when all 7 fields match, or raises a `VERIFY_DIFF` flag (`hasFailures = true`) detailing any field mismatch.
3. **Sleeper Reconciliation Check:**
   - Finds the `WeekRecord` in `data/weeks.json` where `week.startDate <= date <= week.endDate` and fetches Sleeper `GET /v1/league/{leagueId}/matchups/{leg}` (Roster 1 `players_points`).
   - **Formal Check (`UNLOCKED_LATEST_IN_LEG`):** Applies when the player has **no** `LockRecord` in `data/locks.json` for `leg` AND `date` is the player's latest played game date in `[week.startDate, week.endDate]` (across existing `game-logs.json` plus proposed logs).
     - If `round2(fantasyPoints(proposed).total) === round2(sleeperPoints)`, reconciliation passes (`status: "MATCH"`).
     - If they differ, raises a `RECONCILE` flag: `RECONCILE: {name} ({sleeperId}) {date} computed {computedTotal} vs Sleeper {sleeperTotal} (diff {diff})` and sets `hasFailures = true`.
   - **Informational Reference (`LOCKED` or `EARLIER_IN_LEG` or `NO_WEEK`):** When the formal check does not apply, the report still prints Sleeper's current `players_points[sleeperId]` (if available) alongside the proposed log for human inspection without failing.
4. **Output & Path Safety Guard (`--out <path>`):**
   - Always prints the human-readable ingestion/reconciliation report and proposed `GameLog[]` JSON array to stdout.
   - When `--out <path>` is provided, writes the proposed `GameLog[]` JSON array to `<path>`, **rejecting any target path that resolves inside `data/`** so committed repository data files are never overwritten by the script.
   - Exits with code `1` when any `RECONCILE` or `VERIFY_DIFF` flag is raised, any fetch/parse fails, or CLI arguments are invalid; exits with code `0` otherwise.

### 9.4 Verified Roster 1 Mapping (`data/espn-player-map.json`)
| `sleeperId` | `espnAthleteId` | `name` | `espnTeam` |
|---|---|---|---|
| `2267` | `4432166` | Cade Cunningham | `DET` |
| `2181` | `4683021` | Deni Avdija | `POR` |
| `1752` | `4066336` | Lauri Markkanen | `UTA` |
| `1739` | `3155942` | Domantas Sabonis | `SAC` |
| `2714` | `5174563` | Kyshawn George | `WAS` |
| `2441` | `4433136` | Walker Kessler | `LAL` |
| `4737` | `5124612` | VJ Edgecombe | `PHI` |
| `1074` | `4251` | Paul George | `BOS` |
| `2131` | `4397136` | Saddiq Bey | `NOP` |
| `1998` | `4395651` | Coby White | `CHA` |
| `2583` | `4432848` | Jaime Jaquez Jr. | `MIL` |
| `4742` | `5279130` | Nolan Traore | `BKN` |
| `2713` | `4683778` | Jared McCain | `OKC` |
| `4750` | `5144091` | Jeremiah Fears | `NOP` |
| `2456` | `4594327` | Keegan Murray | `SAC` |

### 9.5 Nightly Scheduled Ingestion & PR Proposal Workflow (`.github/workflows/ingest-nightly.yml` + `src/espn/ingest.ts`)
1. **Schedule & Date Window (`computeEasternDateWindow`):**
   - Triggered by GitHub Actions `schedule` cron `0 5 * * *` (UTC: midnight EST / 1am EDT) and `workflow_dispatch` (manual trigger with optional `dates` input).
   - `computeEasternDateWindow(now?: Date): { yesterday: string; today: string; dates: [string, string] }` formats `now` in `America/New_York` (`YYYY-MM-DD`) and computes `[yesterday, today]` using pure UTC calendar-day arithmetic on the Eastern date string.
2. **Branch Proposal Application (`applyIngestionProposal`):**
   - Pure function `applyIngestionProposal({ report, playersFile, existingLogs, weeksFile }): { updatedLogs: GameLog[]; updatedWeeks: WeeksFile; updatedPlayers: PlayersFile }`:
     - Appends `report.proposedLogs` (deduplicated by `(sleeperId, date)`) to `existingLogs`.
     - Identifies every `(team, date)` pair where a discovered game on `date` is `isFinal === true` (plus teams of any player in `report.proposedLogs` on `date`), and removes `date` from `week.remainingGames[sleeperId]` in `weeksFile` for all rostered players on those teams so `validateWeeks` invariants (`remainingGames` contains no played dates and active teammates share identical remaining schedules) always hold.
     - Advances `playersFile.asOf` to `max(playersFile.asOf, ...report.proposedLogs.map(l => l.date))` so Player Detail's trailing time windows (`last-week`, `last-3-weeks`, `last-month`) include the newly ingested games.
3. **PR Metadata & Reconcile Flag Handling (`buildNightlyPrMetadata`):**
   - When `report.proposedLogs.length === 0`, the workflow exits `0` without creating a branch or PR.
   - When `report.proposedLogs.length > 0`:
     - `branchName`: `ingest/${targetDate}` (where `targetDate` is the latest date in `report.proposedLogs`, or `today`).
     - `title`: `data: ingest game logs for ${datesLabel}` when `report.reconcileFlags.length === 0`, or `data: ingest game logs for ${datesLabel} (⚠ reconcile)` when `report.reconcileFlags.length > 0`.
     - `body`: places a prominent `### ⚠ Reconciliation Flags` warning block at the very top of the PR body whenever `report.reconcileFlags.length > 0`, followed by the formatted ingestion report.
   - Network or payload parse errors exit non-zero and fail the GitHub Actions job visibly without opening a PR.
4. **In-Workflow Validation Gate (`GITHUB_TOKEN`):**
   - Uses the built-in `GITHUB_TOKEN` with `contents: write` and `pull-requests: write` (never commits to `main` and never auto-merges).
   - Because PRs opened with `GITHUB_TOKEN` do not trigger `pull_request` workflows, `.github/workflows/ingest-nightly.yml` runs `npm run validate`, `npm test`, and `npm run build` directly on the `ingest/YYYY-MM-DD` branch before pushing and creating/updating the PR against `main`.
