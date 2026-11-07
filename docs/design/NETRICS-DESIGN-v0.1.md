# Netrics — Design Doc v0.1 (DRAFT)

**Status:** DRAFT — for blind review. No code until this doc survives review.
**Revision (2026-11-07, user-confirmed):** (1) Player is **Kyshawn George (WAS, ID 2714)**, not Keyonte George. (2) **Markkanen's Week 3 lock is 47.50** — user-confirmed, source of truth; Sleeper's 39.50 for him is wrong/unexplained and must not be used as a lock score. (3) **Scope change: lock logic is DEFERRED. v1 is analytics per player only** — distribution, ceiling, beat-rate, spike drivers. No lock advisor, no week-matchup lock engine in v1.
**Date:** 2026-11-07
**Author:** Muse (designer)
**Reviewer:** Gemini (independent, no memory of this design — Elephant-Goldfish Model)
**Repo (planned):** `Netrics` — GitHub, Vite + React + TypeScript, GitHub Pages
**League:** Sleeper, "Beltline Ballers", league_id `1358656481750171649`

## 1. Problem

The user plays a Sleeper NBA lock-in redraft league. Each week he must decide,
per player, whether to **lock** a game score already banked or **let it ride**
for a later game that week.

His stated criterion (Oct 29, sharpened Nov 6): **spikes, not averages.**
Season averages and Sleeper projections are the middle of the range, not a
ceiling. A lock call must be judged by the game-by-game distribution, the
best games, and what actually drives a spike — not by the average.

Netrics v1 is a **per-player analytics tool**, not a lock-decision engine.
Its job: for any player on the roster, show the game-by-game distribution,
the ceiling, the beat-rate vs. a given score, and what actually drives his
spikes — with the math shown. Lock logic (whether to lock a banked score vs.
let it ride, week totals, matchup decisions) is **deferred to a later phase**
and must not be built in v1. The lock-related analytics in §5 (beat-rate,
upside/downside) stay, because they are per-player numbers; they are not a
lock recommendation.

## 2. Verified source of truth

Fetched live from the Sleeper API on 2026-11-07 ~10:56 AM ET.
Do not replace these with memory or with a guess.

- League: **Beltline Ballers**, 12 teams, season `2026`, `in_season`, Week 3 / leg 3, season started 2026-10-20.
- User: `jiph`, owner_id `1266488859059830784`, **roster_id 1**, record **2-0**, fpts 807.50, fpts against 634.25.
- Week 3 matchup (matchup_id 4): **jiph 384.75 vs. notNoah224 317.00**.
- Roster positions: `PG, SG, G, SF, PF, F, C, UTIL, UTIL, BN x5` — 9 starters + 5 bench. Reserve slots: 2.
- Scoring (`scoring_settings`, exact from Sleeper — matches the Oct 26 settings the user gave):

| Category | Points |
|---|---|
| Points (pts) | 1.0 |
| Rebound (reb) | 1.25 |
| Assist (ast) | 1.5 |
| Steal (stl) | 3.0 |
| Block (blk) | 3.0 |
| Turnover (to) | -1.0 |
| Double-double (dd) | +2.0 |
| Triple-double (td) | +3.0 |
| Technical foul (tf) | -2.0 |
| Flagrant foul (ff) | -2.0 |
| 40+ points bonus | +1.0 |
| 50+ points bonus | +1.0 |
| 15+ assists bonus | +1.0 |
| 20+ rebounds bonus | +1.0 |
| Three-pointers made (tpm) | 0.0 — score only listed categories |

### 2.1 Roster as fetched (Sleeper player IDs)

Starters are as returned by Sleeper on 2026-11-07. They differ from the
Nov 6 screenshot starting nine — see §12, do not silently overwrite history.

| Sleeper ID | Player | Team* | Pos | Status 2026-11-07 |
|---|---|---|---|---|
| 2267 | Cade Cunningham | DET | PG | Starter |
| 2181 | Deni Avdija | POR | PF | Starter |
| 4750 | Jeremiah Fears | NOP | PG | Starter |
| 1752 | Lauri Markkanen | UTA | PF | Starter |
| 1739 | Domantas Sabonis | SAC | C | Starter |
| 2714 | Kyshawn George | WAS | SF | Starter |
| 2441 | Walker Kessler | LAL | C | Starter |
| 4737 | VJ Edgecombe | PHI | SG | Starter |
| 2713 | Jared McCain | OKC | SG | Starter |
| 1074 | Paul George | BOS | SF | Bench |
| 2131 | Saddiq Bey | NOP | SF | Bench |
| 1998 | Coby White | CHA | PG | Bench |
| 2583 | Jaime Jaquez Jr. | MIL | PF | Bench |
| 4742 | Nolan Traore | BKN | PG | Bench |
| 2456 | Keegan Murray | SAC | PF | Reserve / IR |

\* Team abbreviations are as returned by Sleeper's player file on 2026-11-07.
They are not to be "corrected" from memory without a source.

Week 3 `starters_points` from Sleeper, in starter order above:
`[61.75, 49.75, 41.75, 39.50, 35.50, 39.50, 38.00, 37.75, 41.25]` = 384.75.
Note: the 39.50 listed for Markkanen here is **not** his lock — user confirmed
his Week 3 lock is 47.50. Sleeper's matchup points are not lock scores and
are not used for lock logic (deferred, §12.1).

## 3. Scoring engine — the heart

One pure function, no UI, no network. Everything else calls it.

```
fantasyPoints(g: GameLog) -> { total, breakdown }
total = pts*1 + reb*1.25 + ast*1.5 + stl*3 + blk*3 - tov
      + (isDoubleDouble ? 2 : 0) + (isTripleDouble ? 3 : 0)
      + (pts >= 40 ? 1 : 0) + (pts >= 50 ? 1 : 0)
      + (ast >= 15 ? 1 : 0) + (reb >= 20 ? 1 : 0)
      - tf*2 - ff*2
```

Rules:
- A triple-double counts as **both** DD (+2) and TD (+3) only if Sleeper does so.
  Verify against a known TD line before v1 ships; do not assume. Label the
  assumption in code until verified.
- Bonuses stack: 50 points earns both the 40+ and 50+ bonuses (+2 total).
- Score only the categories in §2. Three-pointers made = 0.
- Round to 2 decimals (Sleeper uses .25 / .50 increments from reb/ast).

### Worked examples (must pass as unit tests)

- **Avdija, Nov 6 vs LAL (final):** 22 pts, 9 reb, 11 ast, 2 stl, 0 blk, 8 tov, DD.
  22 + 11.25 + 16.5 + 6 + 0 − 8 + 2 = **49.75** ✓
- **Markkanen, Nov 4 @ NOP (lock candidate):** 21 pts, 10 reb, 4 ast, 1 stl, 2 blk, 3 tov, DD.
  21 + 12.5 + 6 + 3 + 6 − 3 + 2 = **47.50** ✓
- **Kessler, Nov 4 @ SAC (lock candidate):** 15 pts, 8 reb, 0 ast, 3 stl, 4 blk, 0 tov.
  15 + 10 + 0 + 9 + 12 − 0 = **46.00** ✓
- **Fears, Nov 6 vs MIN (locked):** 24 pts, 5 reb, 5 ast, 2 stl, 0 blk, ? tov.
  24 + 6.25 + 7.5 + 6 = 43.75 before turnovers; Sleeper total **41.75** implies 2 tov. Verify tov count in the seed data; do not hard-code 41.75 without its line.
- **McCain, Nov 6 @ MEM:** 21 pts, 5 reb, 0 ast, 4 stl, 1 blk, 1 tov.
  21 + 6.25 + 0 + 12 + 3 − 1 = **41.25** ✓

## 4. Data model (TypeScript)

```ts
type RosterStatus = "starter" | "bench" | "reserve";

interface Player {
  sleeperId: string;      // e.g. "2181" — stable key, never the name
  name: string;
  team: string;           // Sleeper team abbrev
  positions: string[];    // Sleeper positions
  rosterStatus: RosterStatus;
}

interface GameLog {
  sleeperId: string;
  date: string;           // YYYY-MM-DD, America/New_York game date
  opponent: string;
  pts: number; reb: number; ast: number;
  stl: number; blk: number; tov: number;
  tf?: number; ff?: number;
  source: string;         // e.g. "sleeper-matchup-w3", "box-score Nov 6"
  // fantasyTotal is DERIVED by the scoring engine, never stored as input
}

interface Week {
  id: number;             // Sleeper leg/week, e.g. 3
  startDate: string; endDate: string;
  matchupId: number;
  opponentRosterId: number;
  opponentPoints: number | null;
}

interface Lock {
  sleeperId: string;
  weekId: number;
  lockedDate: string;     // game date whose score was locked
  lockedPoints: number;   // computed by scoring engine from that GameLog
  status: "locked" | "riding";
}
```

Invariants:
- One `GameLog` per player per date. Duplicate (player, date) is a validation error.
- `fantasyTotal` is never hand-entered; it is always recomputed.
- Every `GameLog` carries a `source`. Unsourced numbers are not shipped.

## 5. Analytics — what the app must compute

All from the game-by-game distribution, never from the average alone:

1. **Distribution:** sorted game scores (high → low), with date/opponent/line for each.
2. **Ceiling / floor / median:** best, worst, median. Median is shown; mean is shown only labelled as mean, never as the decision number.
3. **Beat-rate vs. lock candidate:** `beaten / games played`, and the list of games that beat it, with margins. E.g. Kessler beat 46.00 in 2 of 9 games (62.50, 48.25).
4. **Spike drivers:** for each top game, the points contributed by pts / reb / ast / stocks (stl+blk). E.g. McCain's 41.25 was 15.00 from stocks alone.
5. **Lock EV (gamble vs. lock):** expected gain = average of (later-game score − lock) over comparable remaining games is **not** used. Instead show: best / median / worst remaining outcome, beat-rate, and the max upside (ceiling − lock) vs. max downside (lock − floor). No invented probability.
6. **Bench swing:** best bench `fantasyTotal` for the week vs. worst starter in the same slot — the swap value, with names.
7. **Week matchup:** user's locked + riding total vs. opponent's banked/projected total, and how much is still undecided.

What the app must **not** do: present a Sleeper projection or a season average as a ceiling, or recommend a lock on average alone.

## 6. Data pipeline — v1 manual, real data only

- **No dummy data.** Seed with real data: the 15 roster players in §2.1, plus their real 2026-27 game logs to date, each with a `source`.
- Seed source, in order: (a) Sleeper `matchups/{week}` `players_points` for weekly totals, (b) box scores verified in chat / web for individual lines. Where a full line cannot be verified, store the weekly total only and mark the line `unverified — total only`.
- Files: `data/players.json`, `data/game-logs.json`, `data/weeks.json`, `data/locks.json`. Committed to GitHub, human-readable.
- Update flow v1: edit the JSON (or paste a CSV that a small script converts), run `npm run validate`, commit. No live fetch in v1.
- Later (Phase 3, separate design): optional one-time Sleeper import script. Sleeper's public API needs no auth for league/rosters/matchups; it does **not** by itself give full box-score lines, so a stats source must be chosen then — do not promise it in v1.

## 7. App views (v1 — analytics per player only)

1. **Roster:** starters vs. bench, each with last game, week total, ceiling.
2. **Player detail:** distribution chart/table, spike drivers, beat-rate vs. any selected score.
3. **Lock advisor:** DEFERRED — do not build in v1.
4. **Week matchup:** DEFERRED — do not build in v1.

Design: mobile-first, one screen per view, numbers large, no clutter. Dark, basketball-simple. No login, no backend.

## 8. Tech, repo, and multi-agent rules

- **Stack:** Vite + React + TypeScript. Static site, GitHub Pages. No server, no DB, no secrets in the repo.
- **Repo layout (planned):**
  ```
  Netrics/
    docs/design/NETRICS-DESIGN-v0.1.md   # this file
    docs/decisions/                       # ADRs, one per real decision
    data/players.json data/game-logs.json data/weeks.json data/locks.json
    src/scoring/                          # pure engine + tests ONLY
    src/analytics/                        # distribution, beat-rate, EV
    src/ui/                               # Roster, Player, Lock, Week views
    src/data/                             # loaders + validation
    AGENTS.md                             # rules every agent follows
    README.md
  ```
- **AGENTS.md rules (to be written before code):**
  - Scoring changes require a failing-then-passing unit test from §3.
  - Never invent a stat line; unsourced = unverified, labelled as such.
  - Small PRs, one feature per PR, no direct commits to `main`.
  - Do not change the data model without updating this design doc + an ADR.
  - Any agent (Muse, Gemini, other) works from the same `docs/design/` + `AGENTS.md`.
- **Hosting:** GitHub Pages from `main`. Public vs. private repo: user to confirm — public is simpler for Pages + multi-agent, private keeps league data out of public view. Default recommendation: **private repo, Pages still works**.

## 9. Testing

- Scoring engine: unit tests for every worked example in §3, plus edge cases — triple-double stacking (once verified), 50-point game (+2 bonuses), 20-rebound game, 0-stat game, negative (high-tov) game.
- Analytics: beat-rate and distribution tests on a fixed fixture (Kessler's 9-game list from §5: 42.75, 62.50, 12.75, 28.00, 32.75, 45.25, 48.25, 43.75, 46.00).
- Validation: `npm run validate` fails on duplicate (player, date), missing source, or a stored total that disagrees with the engine.

## 10. Phases

- **Phase 0 (now):** This design doc → Gemini blind review → revise → freeze v1.0.
- **Phase 1:** Scoring engine + tests + validation + seed data (real, sourced).
- **Phase 2:** Roster + Player detail views — the v1 analytics app.
- **Phase 3 (later, separate design):** Lock advisor + Week matchup views. DEFERRED by user decision 2026-11-07.
- **Phase 4 (later, separate design):** Sleeper import / live stats. Not in v1.

## 11. Non-goals (v1)

- No live scores, no auto-sync, no login, no waiver/trade advice, no other leagues, no projections as recommendations, no dummy/seed-random data, **no lock logic in v1**.

## 12. Open questions — must be resolved before / during review

1. **Lock mechanics in Sleeper — DEFERRED, do not build in v1:** User confirmed Nov 7 he locked Markkanen at **47.50** for Week 3; Sleeper's 39.50 for him is wrong/unexplained. Sleeper `starters_points` must not be treated as lock scores. Lock logic is out of v1 scope entirely; revisit only in Phase 3 with a separate design.
2. **Kyshawn vs. Keyonte George — RESOLVED Nov 7:** User confirmed **Kyshawn George (WAS, ID 2714)**. Earlier Keyonte references were an error and have been corrected in memory.
3. **Lineup churn:** Nov 6 screenshot starters included Paul George and Saddiq Bey; the Nov 7 Sleeper fetch has them on the bench and Sabonis / McCain starting. Is that a lineup change the user made, or a Sleeper display difference? The design must treat `rosterStatus` as a dated snapshot, not a permanent fact.
4. **Team abbreviations:** Sleeper lists Kessler as LAL, Jaquez Jr. as MIL, McCain as OKC. Confirm these are the 2026-27 teams in this simulated season; do not "fix" them from memory.
5. **Triple-double stacking:** Does Sleeper award DD +2 **and** TD +3 on a triple-double (+5), or TD only (+3)? Verify with a known TD line.
6. **Repo visibility:** public or private? (see §8)
7. **Game-log source for v1 seed:** Sleeper weekly totals + chat-verified box scores, or a named stats source (e.g. Basketball-Reference) for full lines? Pick one before Phase 1.

## 13. Reviewer checklist (for Gemini)

- Is the scoring formula complete and unambiguous, including bonuses and TD stacking?
- Is the data model sufficient for the lock decision, or is a field missing?
- Does any analytics claim invent a probability or use an average as a ceiling?
- Is the manual-data flow workable weekly, or is it too burdensome?
- Are the open questions in §12 the right blockers, and is anything else a blocker?
- What would you change before any code is written?
