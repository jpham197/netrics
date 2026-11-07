# ADR-0002: Phase 3 — Lock Record Source of Truth and Advisor EV Model

**Date:** 2026-11-07
**Status:** Accepted (reviewed in `docs/reviews/2026-11-07-gemini-phase3-review.md`, frozen in `docs/design/NETRICS-DESIGN-PHASE3-v1.0.md`)
**Context:** Phase 3 adds a lock advisor, weekly matchup view, and bench swing. All three depend on knowing, per player per leg, whether a score is locked and what the locked score is — and on a decision rule for lock-vs-ride that the user can trust. Sleeper's API exposes live week scores but no lock endpoint, and its live numbers have been observed to lag lock actions (Markkanen 39.50 at 10:56 AM Nov 7, 47.50 by 1:24 PM the same day). Meanwhile, both apparent Leg 3 score discrepancies (`Sabonis 35.50` and `Kyshawn George 57.00`) were resolved via primary box-score/play-by-play verification (Sabonis committed a Flagrant 1 foul `ff: 1` at `Q2 00:31.2` on Nov 6 vs SAS for `37.50 - 2.00 = 35.50`; Kyshawn George was credited with `8 ast` on Nov 6 @ATL for `57.00`).

## Decision 1: The lock record is `data/locks.json`, entered by the user

- A lock exists in Netrics only if a `LockRecord` exists in `data/locks.json`.
- Sleeper's live `players_points` / `starters_points` are **never** treated as a lock record and are never used to infer a lock.
- Opponent totals are stored as a verified snapshot in `data/weeks.json` (so the app works offline with zero network dependency) with an optional manual override in the UI.
- Rationale: the lock is an action the manager takes in Sleeper's UI; no API surface reliably reports it, and the observed 39.50 → 47.50 transition proves the live numbers can disagree with the lock for hours.
- Consequence: historical locks (legs 2–3) must be entered/confirmed by the user.

## Decision 2: The advisor maximizes expected value over the player's own distribution

- For a banked score `B` and `n` remaining games:
  - `beatingGames` = games in the player's full season distribution with `total > B` (strict `>`).
  - `nonBeatingGames` = games in the player's full season distribution with `total <= B` (including ties `total === B` with `0` shortfall).
  - `beatRate = beatingGames.length / N`
  - `meanUpsideRaw = sum(g.total - B for g in beatingGames) / beatingGames.length` (or `0` if empty)
  - `meanShortfallRaw = sum(B - g.total for g in nonBeatingGames) / nonBeatingGames.length` (or `0` if empty)
  - `pAnyBeat = n > 0 ? 1 - (1 - beatRate)^n : 0`
  - `rideEV = round2(pAnyBeat * meanUpsideRaw - (1 - pAnyBeat) * meanShortfallRaw)` (computed from unrounded intermediates so `rideEV(B, 1) === round2(mean - B)`).
- Recommendations (for unlocked starters with `B !== null` and `n > 0`):
  - `LOCK` if `rideEV <= 0`
  - `RIDE` if `rideEV > 0` and `pAnyBeat >= 0.5`
  - `LEAN_RIDE` if `rideEV > 0` and `pAnyBeat < 0.5`
- Sequential stopping model (§4.3): Riding models the legal Sleeper strategy **"lock the FIRST remaining game that strictly beats `B` (or end the week with the final game if none beat `B`)"**, treating remaining games as independent draws from the player's season distribution.
- Consequence: the advisor can recommend a `LOCK` that loses ex post (Avdija, Nov 6: advised `LOCK` at `46.75` with `rideEV = -4.79`, finished `49.75`). That is expected behavior for an EV rule and must never be presented as a single-game prediction.

## Decision 3: Weeks are Sleeper legs (Monday–Sunday) and locked/completed starters have fixed week bounds

- A "week" in Netrics Phase 3 is a Sleeper leg (Monday–Sunday, with Leg 1 truncated to Oct 20–25).
- `weeks.json` snapshots the roster (`starters`, `bench`, `reserve`), `remainingGames`, and `opponentPoints` per leg.
- In the Weekly Matchup View, any starter who is **locked** OR has **`n === 0` remaining games** has `bestCase = banked` and `worstCase = banked`. Only unlocked starters with `n > 0` remaining games have `bestCase = max(banked, ceiling)` and `worstCase = floor`.

## Alternatives considered

- **Infer locks from Sleeper's live scores**: rejected — live scores can lag lock actions, and a player whose most recent game equals an earlier score would be misread as locked.
- **Beat-rate threshold rule instead of EV**: rejected — discards margin sizes (`meanUpside` vs `meanShortfall`), which distinguish Avdija's case (`+2.00` upside vs `-5.92` shortfall) from Kessler's (`+10.08` upside vs `-10.13` shortfall).
- **Opponent distributions**: not modelled — Netrics has no verified logs for opponent players. Opponent current total is shown without invented bounds.

