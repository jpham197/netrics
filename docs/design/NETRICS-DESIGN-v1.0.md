# Netrics — Design Doc v1.0 (FROZEN)

**Status:** FROZEN — Phase 0 blind review complete (`docs/reviews/2026-11-07-gemini-blind-review.md`). Ready for Phase 1 implementation.
**Date:** 2026-11-07
**Authors:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)
**Repo:** `jpham197/netrics` (Private GitHub repo, Vite + React + TypeScript, GitHub Pages via GitHub Actions)
**League:** Sleeper NBA Lock-In Redraft, "Beltline Ballers", `league_id`: `1358656481750171649`

---

## 1. Problem & v1 Scope

The user plays a Sleeper NBA lock-in redraft league. Each week he must decide, per player, whether to **lock** a game score already banked or **let it ride** for a later game that week.

His core criterion: **spikes, not averages.** Season averages and Sleeper projections represent the middle of the range, not a player's ceiling. A lock evaluation must be grounded in the player's game-by-game score distribution, his ceiling, his empirical beat-rate against a candidate score, and the stat categories driving his spikes — with all math shown transparently.

### v1 Scope (Per-Player Analytics Only)
Netrics v1 is strictly a **per-player analytics tool**, not a lock-decision engine or matchup tracker:
- For any player on the roster, v1 shows the **game-by-game distribution**, **ceiling / median / floor**, **beat-rate and upside/downside vs. any target score**, and **spike drivers** (the exact point breakdown across categories).
- **Deferred to Phase 3 (out of v1 scope):** Lock advisor, weekly matchup totals, remaining-games weekly EV, bench swing swaps, and `Week` / `Lock` data files (`weeks.json`, `locks.json`).

---

## 2. Verified Source of Truth

Fetched live from the Sleeper API on 2026-11-07 ~10:56 AM ET. Never replace verified data with conversational memory or guesses.

- **League:** Beltline Ballers, 12 teams, season `2026` (2026–27 NBA season), `in_season`, Week 3 / leg 3, season started `2026-10-20`.
- **Owner:** `jiph`, `owner_id`: `1266488859059830784`, `roster_id`: `1`.
- **Roster positions:** `PG, SG, G, SF, PF, F, C, UTIL, UTIL, BN x5` (9 starters + 5 bench + 2 reserve/IR).
- **Scoring (`scoring_settings`, exact from Sleeper):**

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

### 2.1 Roster Snapshot (`asOf: "2026-11-07"`)

`rosterStatus` is a dated snapshot from Sleeper on `2026-11-07`, not a permanent invariant. Team abbreviations must be verified against the Sleeper player database / 2026–27 NBA roster during Phase 1 seed validation and never altered from memory.

| Sleeper ID | Player | Team (as fetched 2026-11-07) | Pos | Status (`2026-11-07`) |
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

> **Historical note for future phases:** User confirmed on 2026-11-07 that Lauri Markkanen's Week 3 locked score is **47.50** (from Nov 4 @ NOP), whereas Sleeper's `matchups/3` `starters_points` array returned `39.50` for his slot. Sleeper `starters_points` must never be treated as locked scores.

---

## 3. Scoring Engine — Pure & Deterministic (`src/scoring/`)

One pure function with zero UI or network dependencies. Every view, analytics function, and validator calls it.

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

### Worked Examples (Required Unit Tests in Phase 1)

- **Avdija, 2026-11-06 vs LAL:** `22 pts, 9 reb, 11 ast, 2 stl, 0 blk, 8 tov` (DD: pts, ast)
  `22.00 + 11.25 + 16.50 + 6.00 + 2.00 - 8.00` = **49.75** ✓
- **Markkanen, 2026-11-04 @ NOP:** `21 pts, 10 reb, 4 ast, 1 stl, 2 blk, 3 tov` (DD: pts, reb)
  `21.00 + 12.50 + 6.00 + 9.00 + 2.00 - 3.00` = **47.50** ✓
- **Kessler, 2026-11-04 @ SAC:** `15 pts, 8 reb, 0 ast, 3 stl, 4 blk, 0 tov` (no DD)
  `15.00 + 10.00 + 0.00 + 21.00 + 0.00 - 0.00` = **46.00** ✓
- **Fears, 2026-11-06 vs MIN:** `24 pts, 5 reb, 5 ast, 2 stl, 0 blk, 2 tov` (verify `tov = 2` from box score in Phase 1 seed)
  `24.00 + 6.25 + 7.50 + 6.00 + 0.00 - 2.00` = **41.75** ✓
- **McCain, 2026-11-06 @ MEM:** `21 pts, 5 reb, 0 ast, 4 stl, 1 blk, 1 tov` (no DD)
  `21.00 + 6.25 + 0.00 + 15.00 + 0.00 - 1.00` = **41.25** ✓
- **Verified Triple-Double (Cade Cunningham or Domantas Sabonis Phase 1 seed):** Must verify `isDoubleDouble && isTripleDouble` (+5.0 bonus) against `expectedTotal` from Sleeper.

---

## 4. Data Model (`src/data/`)

v1 ships two JSON data files under `data/`: `data/players.json` and `data/game-logs.json`.

```ts
export type RosterStatus = "starter" | "bench" | "reserve";

export interface Player {
  sleeperId: string;           // e.g. "2181" — canonical primary key, never player name
  name: string;
  team: string;                // Verified Sleeper/NBA team abbreviation
  positions: string[];         // e.g. ["PF"]
  rosterStatus: RosterStatus;  // Snapshot status as of PlayersFile.asOf
}

export interface PlayersFile {
  asOf: string;                // YYYY-MM-DD snapshot date (e.g. "2026-11-07")
  leagueId: string;            // "1358656481750171649"
  players: Player[];
}

export interface GameLog {
  sleeperId: string;           // Foreign key -> Player.sleeperId
  date: string;                // YYYY-MM-DD (America/New_York game date)
  opponent: string;            // e.g. "LAL" or "@NOP"
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  tf?: number;                 // Defaults to 0
  ff?: number;                 // Defaults to 0
  source: string;              // Required provenance, e.g. "sleeper-gamelog+nba-box-2026-11-06"
  expectedTotal?: number;      // Optional validation-only cross-check; NEVER read by UI/analytics
}
```

### Data Invariants (Enforced by `npm run validate`)
1. **Complete box scores only:** Every `GameLog` must have non-negative integers for `pts, reb, ast, stl, blk, tov` (and `tf, ff` when present). Weekly multi-game totals are never stored in `game-logs.json`.
2. **Unique `(sleeperId, date)`:** At most one `GameLog` per player per date.
3. **Referential integrity:** Every `GameLog.sleeperId` must exist in `players.json`.
4. **Mandatory provenance:** `source` must be a non-empty string on every `GameLog`.
5. **Derived total cross-check:** `fantasyTotal` is always computed at runtime by `fantasyPoints(log)`. If `expectedTotal` is present on a `GameLog`, `npm run validate` fails if `fantasyPoints(log).total !== log.expectedTotal`.

---

## 5. Per-Player Analytics (`src/analytics/`)

All metrics are derived from a player's scored game logs:

1. **Distribution:** Game logs sorted descending by `total` (with chronological sort toggle in the UI), carrying `date`, `opponent`, raw stat line, `total`, and 6-part `breakdown`.
2. **Summary Stats:**
   - `gamesPlayed`: count of scored games (`GP`)
   - `ceiling`: maximum game `total`
   - `floor`: minimum game `total`
   - `median`: middle value of sorted `total`s (for even `GP`, the average of the two middle values rounded to 2 decimals)
   - `lastGame`: the `GameLog` with the latest `date`
   - `mean`: arithmetic average rounded to 2 decimals (labelled explicitly as `Mean (ref only)` in Player Detail; never shown on Roster or used as a decision target).
3. **Target Score Evaluation (Beat-Rate & Upside/Downside):**
   Given any target score `target`:
   - `beatingGames`: all games where `game.total > target` (strictly greater than `>`), sorted high → low, with `margin = round2(game.total - target)`.
   - `beatCount = beatingGames.length`
   - `beatRate = gamesPlayed > 0 ? beatCount / gamesPlayed : 0`
   - `maxUpside = Math.max(0, round2(ceiling - target))`
   - `maxDownside = Math.max(0, round2(target - floor))`
4. **Spike Drivers:**
   - Every game includes its 6-part `ScoreBreakdown` (`scoring`, `rebounds`, `playmaking`, `stocks`, `bonuses`, `penalties`).
   - The **Top 3 games** by `total` are flagged as `isSpike: true` and tagged with their primary non-scoring catalyst or dominant category (e.g. share of points from `stocks`, `playmaking`, `rebounds`, `scoring`).

---

## 6. App Views (`src/ui/`)

Mobile-first, dark theme, high-contrast typography, zero login/backend.

1. **Roster View:**
   - Header displaying league name (`Beltline Ballers`) and `Roster snapshot as of YYYY-MM-DD`.
   - Grouped into `Starters`, `Bench`, and `Reserve / IR` (with ability to sort rows by **Ceiling**, **Median**, or **Last Game**).
   - Columns per player: **Player (Name, Pos, Team)**, **Ceiling**, **Median**, **Floor**, **Last Game** (score + opponent/date), and **GP**.
   - Tapping any player opens their **Player Detail View**.
2. **Player Detail View:**
   - Header with player metadata and summary cards: **Ceiling**, **Median**, **Floor**, **Last Game**, **GP** (plus secondary muted `Mean (ref only)`).
   - **Target Score Explorer:** Interactive input initialized to `lastGame.total`, plus quick-select chips for each game score in the player's log and custom numeric entry (e.g., `47.50`). Displays:
     - **Beat-Rate:** `X of N games (YY%)` strictly beating target
     - **Max Upside:** `+X.XX` (`ceiling - target`) vs. **Max Downside:** `-Y.YY` (`target - floor`)
     - **Beating Games List:** Date, opponent, score, and `+margin` for each game that beat the target
   - **Game-by-Game Distribution & Spike Drivers:**
     - Visual bar + table for every game (toggleable between **High → Low** and **Latest → Oldest**).
     - Stacked/annotated 6-part breakdown (`pts`, `reb`, `ast`, `stocks`, `bonuses`, `penalties`) showing the exact math summing to `total`.
     - Top 3 spike games highlighted with primary driver badges.

---

## 7. Repository Layout & Multi-Agent Architecture

```
netrics/
  .github/workflows/ci.yml              # Runs validate, test, build (+ Pages deploy on main)
  docs/
    design/
      NETRICS-DESIGN-v0.1.md            # Original draft (preserved)
      NETRICS-DESIGN-v1.0.md            # Frozen v1 specification (this file)
    reviews/
      2026-11-07-gemini-blind-review.md # Independent Goldfish review
    decisions/
      0001-v1-per-player-analytics-and-data-invariants.md
  data/
    players.json                        # 15 roster players + asOf timestamp
    game-logs.json                      # Verified per-game box scores
  src/
    scoring/                            # Pure scoring engine + unit tests
    analytics/                          # Distribution, beat-rate, spike drivers + unit tests
    data/                               # Schema validation CLI (`npm run validate`) + loaders
    ui/                                 # Roster & Player Detail React components
  AGENTS.md                             # Elephant-Goldfish multi-agent protocol
  README.md
```

---

## 8. Phases

- **Phase 0 (Completed 2026-11-07):** Draft v0.1 → Gemini blind review → User design interview → Freeze v1.0 + ADR-0001 + `AGENTS.md`.
- **Phase 1:** Pure scoring engine (`src/scoring/`), analytics engine (`src/analytics/`), data validator (`npm run validate`), unit test suite (all §3 worked examples + Kessler 9-game fixture + edge cases), and verified real seed data (`data/players.json`, `data/game-logs.json`).
- **Phase 2:** Roster & Player Detail UI (`src/ui/`) + GitHub Actions CI/Pages deployment.
- **Phase 3 (Deferred, separate design):** Lock advisor, weekly matchup view, bench swing.
- **Phase 4 (Deferred, separate design):** Automated Sleeper / box-score ingestion scripts.
