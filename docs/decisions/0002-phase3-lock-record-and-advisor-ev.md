# ADR-0002: Phase 3 — Lock Record Source of Truth and Advisor EV Model

**Date:** 2026-11-07
**Status:** Proposed (with Phase 3 design v0.1, for Gemini blind review)
**Context:** Phase 3 adds a lock advisor, weekly matchup view, and bench swing. All three depend on knowing, per player per leg, whether a score is locked and what the locked score is — and on a decision rule for lock-vs-ride that the user can trust. Sleeper's API exposes live week scores but no lock endpoint, and its live numbers have been observed to lag lock actions (Markkanen 39.50 at 10:56 AM Nov 7, 47.50 by 1:24 PM the same day).

## Decision 1: The lock record is `data/locks.json`, entered by the user

- A lock exists in Netrics only if a `LockRecord` exists in `data/locks.json`.
- Sleeper's live `players_points` / `starters_points` are **never** treated as a lock record and are never used to infer a lock.
- Sleeper's matchup endpoint is used only for the opponent's totals and for a read-only reconciliation report (`npm run reconcile`) that lists mismatches between Netrics' locks + computed scores and Sleeper's live numbers.
- Rationale: the lock is an action the manager takes in Sleeper's UI; no API surface reliably reports it, and the observed 39.50 → 47.50 transition proves the live numbers can disagree with the lock for hours. A record the user enters is checkable; an inferred lock is a guess wearing a fact's clothes.
- Consequence: historical locks (legs 2–3) must be entered/confirmed by the user. Inferred locks (Kessler 45.25 and Sabonis 49.50 in leg 2) ship only as unconfirmed notes until the user confirms them.

## Decision 2: The advisor maximizes expected value over the player's own distribution

- For a banked score `B` and `n` remaining games: `rideEV = pAnyBeat × meanUpside − (1 − pAnyBeat) × meanShortfall`, where all inputs come from the player's full logged-game distribution with strict `>` beat-rate (v1.0 §5).
- Recommendations: LOCK if `rideEV ≤ 0`; RIDE if `rideEV > 0` and `pAnyBeat ≥ 0.5`; LEAN RIDE if `rideEV > 0` and `pAnyBeat < 0.5`.
- Rationale: the user's stated criterion is spikes and distributions, not averages. EV over the distribution is the only rule that uses the whole distribution (both tails) while staying computable from data Netrics already has. A bare beat-rate threshold would ignore how much a beat is worth vs how much a miss costs (Avdija's case: 14% beat-rate with a +2.00 upside vs a −5.92 average shortfall is a clear LOCK, and a threshold rule would need the same numbers anyway).
- Simplifications accepted for v1 of the advisor (documented in the design §4.3): remaining games treated as independent draws from the full-season distribution; ride assumes the manager can lock the best remaining outcome; each starter evaluated independently of matchup context.
- Consequence: the advisor can recommend a LOCK that loses ex post (Avdija, Nov 6: advised LOCK at 46.75, finished 49.75). That is correct behavior for an EV rule and must be presented as such — never as a prediction.

## Decision 3: Weeks are Sleeper legs (Monday–Sunday)

- A "week" in Netrics Phase 3 is a Sleeper leg. Leg 1 is truncated to the season start (Oct 20). Evidence: leg-2 scores include Nov 1 (Sunday) games (Paul George 44.50, Traore 29.50); leg 3 includes Nov 2 (Monday) games.
- `weeks.json` snapshots the roster per leg (starters/bench/reserve), because rosters churn mid-season (Jarace Walker started leg 2 and is gone in leg 3).
- Consequence: the validator must enforce per-leg roster snapshots; a single current-roster view cannot reconstruct past weeks.

## Alternatives considered

- **Infer locks from Sleeper's live scores** (locked = score that stopped updating): rejected — the 39.50 lag shows live scores can be stale, and a player whose most recent game happens to equal an earlier score would be misread as locked.
- **Beat-rate threshold rule instead of EV** (LOCK if beat-rate < 25%, RIDE if ≥ 50%): rejected for v1 — it discards margin sizes, which are the difference between Avdija's case (small upside, large downside) and Kessler's (large upside, moderate downside). Kept as open question 5 in case the reviewer prefers the simpler rule first.
- **Opponent distributions**: not modelled — Netrics has no verified logs for opponent players, and inventing them would violate the no-dummy-data rule. Opponent totals come from Sleeper live; no opponent analytics are computed.
