# Netrics — Phase 3 Design v0.1 (DRAFT)

**Status:** DRAFT — for Gemini blind review (same process as Phase 0: this doc goes up as a PR, Gemini reviews it against the evidence below, revisions land, then it freezes as v1.1 / Phase 3 spec). No code in this PR.
**Date:** 2026-11-07
**Authors:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)
**Repo:** `jpham197/netrics` (public GitHub repo, Vite + React + TypeScript, GitHub Pages via GitHub Actions)
**League:** Sleeper NBA Lock-In Redraft, "Beltline Ballers", `league_id`: `1358656481750171649`
**Depends on:** `docs/design/NETRICS-DESIGN-v1.0.md` (FROZEN) — scoring engine, analytics, data invariants, and UI in v1 are unchanged by this doc. Phase 3 adds two data files and three views on top of them.

---

## 1. Problem & v1 Scope

v1 answers, per player: what is this player's game-by-game distribution, ceiling, beat-rate, and what drives his spikes. It does not answer the three questions the user actually asks every week:

1. **Lock or ride?** A starter has a score banked from an earlier game this week and another game coming. Should he lock the banked score or let it ride for the later game?
2. **Am I winning the week?** What is the user's current week total vs the opponent's, with games still to play on both sides?
3. **Is a bench swap worth it?** Would swapping a bench player in for a starter gain points this week, given roster-position eligibility?

### Phase 3 Scope (this design)

- **Lock Advisor:** per-starter recommendation (LOCK / RIDE / LEAN) with the full expected-value math shown, grounded in the player's own game distribution — never in a season average.
- **Weekly Matchup View:** user week total vs opponent week total, both sides' remaining games, best/worst-case swing.
- **Bench Swing:** ranked list of bench-for-starter swaps with positive expected gain, respecting position eligibility.
- **New data files:** `data/weeks.json` (per-leg week records) and `data/locks.json` (user-entered lock records). No changes to the v1.0 scoring formula, analytics, or `players.json` / `game-logs.json` schemas.

### Out of scope (deferred)

- Auto-fetching locks from Sleeper: no reliable Sleeper endpoint exposes locks (see §2.4). Locks are entered by the user.
- Trade / waiver / free-agent advice, playoff brackets, projections from season averages as decision targets (the v1.0 mean rule stands: mean appears only as `Mean (ref only)`).
- Phase 4 (automated Sleeper / box-score ingestion) is separate.

---

## 2. Verified Lock Mechanics — How Sleeper Scores a Lock-In Week

This section is the load-bearing evidence for the whole design. Every claim below was checked live against the Sleeper API on 2026-11-07 (~1:24 PM ET) and cross-checked against the verified seed data (`data/game-logs.json`, 118 logs). Nothing here comes from pre-training memory about how Sleeper "probably" works.

### 2.1 The rule

For each rostered player, Sleeper's week score (`players_points` in `GET /league/{id}/matchups/{leg}`, and the matching slot in `starters_points`) is:

- **the locked score, if the manager locked that player during that leg;**
- **otherwise, the player's most recent completed game of that leg.**

A locked score freezes even if the player plays again later in the leg, and even if the player is later moved to the bench. An unlocked player's score floats with each new game until the leg ends (or the manager locks them).

### 2.2 Evidence — leg 2 (final; `last_scored_leg: 2`)

Leg 2 = Oct 26 – Nov 1, 2026. Week-2 `players_points` for the user's roster, against the verified seed logs:

| Player | Sleeper wk-2 score | Seed logs that leg (most recent last) | Verdict |
|---|---|---|---|
| Fears (4750) | 36.75 | Oct 28 20.50, Oct 29 68.50, Oct 31 36.75 | Most recent ✓ |
| Avdija (2181) | 33.25 | Oct 27 41.50, Oct 29 48.75, Oct 31 33.25 | Most recent ✓ |
| Cade (2267) | 31.25 | Oct 27 42.25, Oct 28 51.75, Oct 30 31.25 | Most recent ✓ |
| Paul George (1074) | 44.50 | Oct 27 42.25, Oct 30 44.50, Nov 1 44.50 | Most recent ✓ |
| Markkanen (1752) | 32.00 | Oct 26 2.00, Oct 31 32.00 | Most recent ✓ |
| Traore (4742) | 29.50 | Oct 27 24.75, Oct 30 20.50, Nov 1 29.50 | Most recent ✓ |
| Kyshawn (2714) | 21.25 | Oct 26 27.00, Oct 28 30.00, Oct 30 21.25 | Most recent ✓ |
| McCain (2713) | 19.00 | Oct 26 31.75, Oct 28 18.00, Oct 31 19.00 | Most recent ✓ |
| Kessler (2441) | **45.25** | Oct 27 28.00, Oct 28 32.75, Oct 30 45.25, Nov 1 48.25 | **Locked** at Oct 30 (Nov 1's 48.25 did not replace it) |
| Sabonis (1739) | **49.50** | Oct 27 49.50, Oct 29 40.25, Oct 31 43.50 | **Locked** at Oct 27 (later games did not replace it) |

Two independent checks confirm leg 2 includes Nov 1 (Sunday): Paul George's Nov 1 game (44.50) and Traore's Nov 1 game (29.50) are both reflected as their week-2 scores. **Legs run Monday–Sunday**, with leg 1 truncated to the season start (Tue Oct 20). Leg 3 = Nov 2 – Nov 8.

The two locked cases (Kessler 45.25, Sabonis 49.50) are *inferred* locks — the user has not confirmed them. Phase 3's lock-entry flow must let the user confirm or correct historical locks for legs 2–3 (§3.3).

### 2.3 Evidence — leg 3 (live; `leg: 3`, `last_scored_leg: 2`)

Leg 3 is in progress and unscored, so its numbers are provisional. Live `players_points` at ~1:24 PM ET Nov 7, against seed logs Nov 2–8:

| Player | Sleeper leg-3 score | Seed logs this leg | Verdict |
|---|---|---|---|
| Cade (2267) | 61.75 | Nov 2 61.75, Nov 4 58.25 | Locked at Nov 2 (user-confirmed) |
| Avdija (2181) | 46.75 | Nov 2 37.25, Nov 4 46.75, Nov 6 49.75 | Locked at Nov 4 (user-confirmed) |
| Fears (4750) | 41.75 | Nov 2 23.50, Nov 4 33.50, Nov 6 41.75 | Locked at Nov 6 (user-confirmed) |
| Markkanen (1752) | 47.50 | Nov 2 39.50, Nov 4 47.50, Nov 6 33.50 | Locked at Nov 4 (user-confirmed) |
| Kessler (2441) | 38.00 | Nov 2 43.75, Nov 4 46.00, Nov 6 38.00 | Most recent (unlocked; user declined to lock 46.00) |
| Kyshawn (2714) | 57.00 | Nov 2 39.50, Nov 4 36.50, Nov 6 55.50 (seed) | Most recent (unlocked) — but see conflict §2.5 |
| Edgecombe (4737) | 37.75 | Nov 2 37.25, Nov 4 23.00, Nov 6 37.75 | Most recent (unlocked) |
| McCain (2713) | 41.25 | Nov 2 20.25, Nov 4 11.25, Nov 6 41.25 | Most recent (unlocked) |
| Paul George (1074, bench) | 42.25 | Nov 4 42.25, Nov 6 21.75 | Locked at Nov 4 — lock persists on the bench |
| Bey (2131, bench) | 31.25 | Nov 2 28.75, Nov 4 33.50, Nov 6 31.25 | Most recent (unlocked) |

`points` for the user (roster_id 1) is the sum of the 9 `starters_points`: 61.75 + 46.75 + 41.75 + 47.50 + 35.50 + 57.00 + 38.00 + 37.75 + 41.25 = 407.25. The opponent (roster_id 8, notNoah224) is at 317.25.

### 2.4 The 39.50 anomaly — resolved as far as the evidence goes, and designed around

On Nov 7 ~10:56 AM ET, Sleeper's leg-3 `starters_points` showed **39.50** for Markkanen's slot. 39.50 is his Nov 2 game — neither his locked score (47.50, Nov 4) nor his most recent game (33.50, Nov 6). By ~1:24 PM ET the same slot showed **47.50**. The user had confirmed locking Markkanen at 47.50 on Nov 6.

What this establishes: Sleeper's live leg numbers can lag the manager's lock action, and the lag mechanism is unverified (lock applied after the morning fetch, or an asynchronous scoring update while `last_scored_leg` is still 2 — the API cannot distinguish these). What it does **not** establish: any defect in the 47.50 lock itself.

**Design consequence (non-negotiable):** Netrics must never treat Sleeper's live `players_points` / `starters_points` as a lock record. The lock record is `data/locks.json`, entered by the user. Sleeper's matchup endpoint is used only for the *opponent's* totals and for reconciliation checks that flag mismatches — never as the source of the user's own locks.

### 2.5 Open anomalies (recorded, not resolved — see §7)

- **Sabonis leg-3 score 35.50 matches no seed game.** His leg-3 logs are Nov 2 22.75, Nov 4 41.75, Nov 6 37.50 (17/12/5, 4 tov, double-double: 17 + 15 + 7.50 + 2 − 4 = 37.50). 35.50 equals the Nov 6 line *without* the double-double bonus (37.50 − 2), but no other Sleeper score in legs 2–3 omits a bonus, so that reading is not credible on its own. Resolution path: confirm with the user whether he locked Sabonis at any point, and re-check the Nov 6 box-score turnover count against Sleeper's official line.
- **Kyshawn Nov 6: Sleeper 57.00 vs seed 55.50.** Sleeper's 57.00 implies 8 assists (33 + 5.00 + 12.00 + 3 + 6 − 2 = 57.00); the seed records 7 assists / 55.50 (majority of secondary sources; Basketball-Reference lists 8). Since Sleeper is the league's scorer, its line governs league points. Resolution path: product-owner decision — correct the seed to 8 ast / 57.00, or keep 55.50 with the conflict recorded. This is a data decision for a separate PR, not for Phase 3 code.
- **Roster churn:** leg-2 starter Jarace Walker (Sleeper ID 2563, IND, PF, week-2 score 20.00) is no longer on the roster in leg 3. `weeks.json` must therefore snapshot the roster per leg (§3.1); a single current-roster view cannot reconstruct past weeks.

---

## 3. Data Model (`src/data/` + `data/`)

Two new JSON files under `data/`. No changes to `players.json` or `game-logs.json`.

```ts
export interface WeekRecord {
  leg: number;                 // Sleeper leg, e.g. 3
  startDate: string;           // YYYY-MM-DD, Monday (leg 1: season start 2026-10-20)
  endDate: string;             // YYYY-MM-DD, Sunday
  matchupId: number;           // Sleeper matchup_id for the user's matchup that leg
  opponentRosterId: number;    // Sleeper roster_id of the opponent
  opponentName: string;        // Sleeper username, e.g. "notNoah224"
  starters: string[];          // 9 sleeperIds, in Sleeper's slot order (PG, SG, G, SF, PF, F, C, UTIL, UTIL)
  bench: string[];             // 5 sleeperIds on the bench that leg
  reserve: string[];           // sleeperIds on reserve / IR that leg
  // Remaining games per player in this leg, by date (America/New_York game date).
  // Entered manually from the NBA schedule; the source of "games left" for the advisor.
  remainingGames: Record<string, string[]>; // sleeperId -> ["2026-11-08", ...]
}

export interface WeeksFile {
  leagueId: string;            // "1358656481750171649"
  weeks: WeekRecord[];
}

export type LockSource = "user" | "sleeper-verified";

export interface LockRecord {
  sleeperId: string;           // Foreign key -> Player.sleeperId
  leg: number;                 // Leg the lock belongs to
  gameDate: string;            // YYYY-MM-DD of the locked game (must exist in game-logs.json)
  lockedTotal: number;         // Must equal fantasyPoints(that game log).total
  lockedAt: string;            // ISO 8601 timestamp of when the user made the lock (best knowledge; "" if unknown)
  source: LockSource;          // "user" = entered by the user; "sleeper-verified" = confirmed against Sleeper matchup data
  note?: string;               // Free text, e.g. "confirmed in chat Nov 6 ~7:37pm ET"
}

export interface LocksFile {
  leagueId: string;
  locks: LockRecord[];
}
```

### 3.1 Data invariants (enforced by `npm run validate`, extended in Phase 3b)

1. **One lock per (player, leg).** A second lock for the same player in the same leg is a validation error — in Sleeper a lock replaces nothing; the manager locks once per player per week.
2. **Lock ↔ log consistency.** Every `LockRecord` must reference a `GameLog` with the same `(sleeperId, gameDate)` in `game-logs.json`, and `lockedTotal` must equal `fantasyPoints(that log).total`. A lock for a game with no verified log is an error, never a guess.
3. **Leg bounds.** `gameDate` must fall inside the leg's `[startDate, endDate]` in `weeks.json`; `lockedAt`, when present, must not be after the leg's `endDate` (end of Sunday).
4. **Week completeness.** Each `WeekRecord` has exactly 9 `starters`, 5 `bench`, and the `reserve` list; every id must exist in `players.json`; no id may appear twice in one week. `remainingGames` dates must fall inside the leg and must not include dates on which the player already has a game log (a logged date is played, not remaining).
5. **Sleeper is not the lock record.** No validator rule may infer a lock from Sleeper's live `players_points`. Reconciliation is a *report*, not a rule: a Phase 3b check command (`npm run reconcile`, read-only) compares `locks.json` + computed week scores against a saved snapshot of Sleeper's matchup endpoint and lists mismatches for the user to resolve. It never writes data.
6. **Locks are user-entered.** The UI may offer a lock-entry form (see §7, open question); whether entered in the UI or in JSON, a lock record is created only by an explicit user action, with `source: "user"` unless the user confirms it against Sleeper (`"sleeper-verified"`).

### 3.2 Seed data for Phase 3b

- `weeks.json`: legs 1–3, from Sleeper league/matchup data (leg 1: Oct 20–25, leg 2: Oct 26–Nov 1, leg 3: Nov 2–8; matchup ids and opponents from the API; starters/bench/reserve per leg from the API snapshots — leg-2 roster includes Jarace Walker (2563), leg-3 roster is the current 15).
- `locks.json`: leg 3 locks the user confirmed (Cade 61.75 Nov 2, Avdija 46.75 Nov 4, Fears 41.75 Nov 6, Markkanen 47.50 Nov 4, Paul George 42.25 Nov 4), leg 2 inferred locks (Kessler 45.25 Oct 30, Sabonis 49.50 Oct 27) marked `source: "user"` only after the user confirms them — until then they ship as *unconfirmed* entries with `note` stating the inference, or are omitted and the advisor treats those players as unlocked. The product owner decides at build time; the design does not ship an inferred lock as a fact.

---

## 4. Lock Advisor — Math (`src/advisor/`)

One pure module, zero UI or network dependencies, same discipline as `src/scoring/` and `src/analytics/`. It consumes a player's scored game logs, their banked score for the leg, and their remaining games, and returns a recommendation with every number shown.

### 4.1 Definitions

For a starter with banked score `B` (locked score if a lock exists, else the most recent completed game total of the leg — or `null` if no game yet) and `n` remaining games in the leg:

- `beatRate(B)` — the v1.0 §5 target evaluation: fraction of the player's logged games with `total > B` (strict `>`), over the player's full distribution (all logged games, not just this leg).
- `meanUpside(B)` — mean of `(total − B)` over the beating games (0 if none beat `B`).
- `meanShortfall(B)` — mean of `(B − total)` over the non-beating games (0 if all beat `B`).
- `pAnyBeat(B, n)` — probability at least one of the `n` remaining games beats `B`, under the stated simplification that each remaining game is an independent draw from the player's distribution: `1 − (1 − beatRate(B))^n`. For `n = 0` this is 0.
- `rideEV(B, n)` — expected value of riding (letting the banked score float through the remaining games and locking the best outcome) minus keeping `B`:
  `rideEV = pAnyBeat × meanUpside − (1 − pAnyBeat) × meanShortfall`
  For `n = 0`, `rideEV = 0` (nothing left to ride for). For a locked player, the advisor does not run — the score is frozen; the view shows the lock and what it cost/gained vs the most recent game instead.

### 4.2 Recommendation

- **LOCK** if `rideEV ≤ 0` — riding has non-positive expected value.
- **RIDE** if `rideEV > 0` **and** `pAnyBeat ≥ 0.5` — riding is positive-EV and a beat is more likely than not.
- **LEAN RIDE** if `rideEV > 0` and `pAnyBeat < 0.5` — positive-EV but a beat is the less likely outcome; the user is gambling on the tail.
- **LOCK (ceiling)** — special case, shown as LOCK with a note: if `B ≥ ceiling − 2.00` (the banked score is within 2 points of the player's best-ever game), riding can gain at most the gap to the ceiling; the advisor reports that maximum possible gain explicitly.

Every recommendation displays: `B`, `n`, `beatRate`, `pAnyBeat`, `meanUpside`, `meanShortfall`, `rideEV`, and the recommendation. No recommendation is shown without its inputs. The advisor never uses the season mean as a target or a projection; the mean appears nowhere in this module.

### 4.3 Stated simplifications (for the reviewer to challenge)

1. **Independence:** remaining games are treated as independent draws from the player's full-season distribution. In reality, opponent strength, home/away, minutes, and injuries shift the distribution game to game. The advisor does not model those; a future iteration may weight recent games or add opponent adjustments, but that is out of Phase 3 scope.
2. **Distribution = full season so far:** all logged games count equally, including early-season games. The user may later ask for recency weighting; not in Phase 3.
3. **Ride = lock the best remaining outcome:** the EV model assumes the manager can lock after any remaining game and will take the best one. If the manager cannot watch every game, the realized value is lower; the UI states this assumption next to the recommendation.
4. **One decision at a time:** the advisor evaluates each starter independently. It does not optimize the whole lineup jointly (e.g., riding two players because the matchup is already won). Matchup context is shown alongside the recommendation (§5), not folded into it.

### 4.4 Worked examples (required unit tests in Phase 3b)

**Kessler, leg 3, Sat Nov 7 — banked 38.00 (unlocked), 1 game left (@DET Nov 8).**
Distribution (10 games): 42.75, 62.50, 12.75, 28.00, 32.75, 45.25, 48.25, 43.75, 46.00, 38.00.
- Beat 38.00: 6 of 10 (60.0%) — margins +4.75, +24.50, +7.25, +10.25, +5.75, +8.00 → `meanUpside` = 60.50 / 6 = **10.08**.
- Below: 12.75, 28.00, 32.75 — shortfalls 25.25, 10.00, 5.25 → `meanShortfall` = 40.50 / 3 = **13.50**.
- `pAnyBeat` (n=1) = 0.60. `rideEV` = 0.60 × 10.08 − 0.40 × 13.50 = 6.05 − 5.40 = **+0.65** → **RIDE** (positive EV, beat more likely than not — a thin margin; the UI shows +0.65, not a confident call).
- This matches the decision the user actually faced on Nov 6 (declined to lock 46.00, gambled on the remaining games).

**Avdija, leg 3, before the Nov 6 game — banked 46.75 (after Nov 4), 1 game left (vs LAL Nov 6).**
Distribution through Nov 4 (7 games): 42.50, 43.75, 41.50, 48.75, 33.25, 37.25, 46.75.
- Beat 46.75: 1 of 7 (14.3%) — margin +2.00 → `meanUpside` = **2.00**.
- Below: shortfalls 4.25, 3.00, 5.25, 13.50, 9.50, 0.00 → `meanShortfall` = 35.50 / 6 = **5.92**.
- `rideEV` = (1/7) × 2.00 − (6/7) × 5.92 = 0.29 − 5.07 = **−4.79** → **LOCK**.
- Ex post, Avdija scored 49.75 and beat the lock by 3.00. The advisor would have been "wrong" that night — correctly, by design: it maximizes expected value over the distribution, it does not predict single games. The UI must never present a recommendation as a prediction.

---

## 5. Weekly Matchup View (`src/ui/`)

- **Totals:** user week total = sum over the 9 starters of their current leg score (locked score, else most recent completed game; `null` / "—" if a starter has no game yet). Opponent week total = the opponent's `points` from Sleeper's `matchups/{leg}` endpoint, fetched live at runtime (read-only) with a manual-entry fallback when the fetch fails or the user prefers it. Opponent *player-level* scores are shown as a simple list from the same endpoint (name, score) — no analytics are computed on opponent players (they are not in `players.json`).
- **Remaining games:** per side, count of starters with games left in the leg (from `weeks.json` `remainingGames`), and the dates.
- **Best/worst case:** user best case = sum of each starter's `max(banked, ceiling)`; user worst case = sum of each starter's `min(banked, floor)` — labelled as bounds, not predictions. Same for the opponent using their current totals as both bounds (no distribution data for opponents) — or omit opponent bounds and show only their current total + games left. Reviewer to decide which is less misleading; the design prefers showing the opponent's current total and games left only, with no invented opponent distribution.
- **Matchup context next to the advisor:** each starter's advisor row shows the current matchup margin, so the user can weigh a gamble against the scoreboard (information only — the advisor's EV does not change with the margin, per §4.3.4).

## 6. Bench Swing (`src/ui/`, part of the Matchup View)

For each bench player and each starter slot they are eligible for (eligibility = the bench player's `positions` intersect the slot's position, using `players.json` positions and the league's `roster_positions` order PG, SG, G, SF, PF, F, C, UTIL, UTIL — a player qualifies for a slot if any of their positions equals the slot or the slot is UTIL/G/F):

- `swing = benchValue − starterBanked`, where `benchValue` is the bench player's locked score if locked, else their most recent completed game of the leg (plus their `rideEV` if they have games left — shown separately, not folded in silently).
- Show only swaps with `swing > 0`, ranked high → low, with both numbers and the eligibility basis shown. A swap that requires the starter's own lock to be abandoned is flagged (locking is per player, not per slot — moving a locked starter to the bench keeps their lock, but their score no longer counts; the UI states this).
- No swap is ever executed by the app — Netrics is read-only advice; the user makes the swap in Sleeper.

## 7. App Views (`src/ui/`) — additions

Mobile-first, dark theme, same as v1. New navigation (tabs or a simple view switcher, consistent with the existing `App.tsx` pattern):

1. **Lock Advisor View:** one row per starter: player, banked score (+ which game, + locked/unlocked badge), games left, `beatRate`, `pAnyBeat`, `meanUpside`, `meanShortfall`, `rideEV`, recommendation (LOCK / RIDE / LEAN RIDE). Locked players show their lock, the game it came from, and the cost/gain vs their most recent game. A note states the §4.3 assumptions in plain words next to the table.
2. **Matchup View:** totals, remaining games, best/worst-case bounds, opponent list, and the Bench Swing section (§6).
3. **Roster and Player Detail views are unchanged** (v1.0 §6), except the Player Detail's Target Score Explorer gains a "banked score" chip when the player has a banked score this leg.

## 8. Repository Layout & Phases

```
netrics/
  data/
    weeks.json                          # NEW — per-leg week records
    locks.json                          # NEW — user-entered lock records
  src/
    advisor/                            # NEW — pure lock-advisor math + unit tests
    data/                               # extend validator + loaders for weeks/locks
    ui/                                 # Lock Advisor + Matchup views
  docs/
    design/
      NETRICS-DESIGN-PHASE3-v0.1.md     # this file (DRAFT)
      NETRICS-DESIGN-PHASE3-v1.0.md     # FROZEN after blind review
    decisions/
      0002-phase3-lock-record-and-advisor-ev.md   # NEW ADR (this PR)
```

- **Phase 3a (this PR):** design v0.1 + ADR-0002 → Gemini blind review → freeze as v1.0-equivalent Phase 3 spec.
- **Phase 3b (build, after freeze):** `src/advisor/` + extended validator + `weeks.json` / `locks.json` seed (legs 1–3) + Lock Advisor and Matchup UI + tests (all §4.4 worked examples + week-2 lock-rule fixtures + bench-swing eligibility tests). Must pass `npm run validate && npm test && npm run build` in CI before merge, same as Phases 1–2.
- **Phase 3c (data, with 3b or right after):** user confirms leg-2 inferred locks and resolves the §2.5 anomalies (Sabonis 35.50, Kyshawn 57.00 vs 55.50).

## 9. Open Questions (for Gemini and the product owner)

1. **Sabonis 35.50** (§2.5) — is there a locked score or a stat-line correction behind it? What should the app show for a starter whose Sleeper score matches no verified game?
2. **Kyshawn Nov 6** (§2.5) — correct the seed to Sleeper's 8 ast / 57.00, or keep 55.50 with the conflict recorded? (Sleeper governs league points.)
3. **Opponent data** — live runtime fetch from Sleeper's matchup endpoint, or manual entry? Live fetch is read-only and keeps the app current, but it is a network dependency the v1 design avoided. Which does the reviewer prefer?
4. **Lock entry** — JSON-only for Phase 3b (smallest scope, locks edited in `locks.json`), or a UI form in the Advisor view? JSON-only is recommended in this draft; the UI form can follow once the math is proven.
5. **Advisor simplifications** (§4.3) — is the independence assumption acceptable for v1 of the advisor, or should the first version use a simpler rule (e.g., LOCK if `beatRate < 0.25`, RIDE if `beatRate ≥ 0.5`, LEAN otherwise) and add EV later?
6. **Best/worst-case bounds** (§5) — show the opponent's bounds or current-total-only? The draft prefers current-total-only for the opponent.
