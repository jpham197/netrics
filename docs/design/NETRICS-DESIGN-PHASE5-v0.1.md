# Netrics — Phase 5 Specification v0.1 (DRAFT)

**Status:** DRAFT — For Gemini blind review (same process as Phase 0, Phase 3, Phase 4: design v0.1 → Gemini review → revisions → freeze → build).
**Date:** 2026-11-07
**Authors:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)
**Repo:** `jpham197/netrics` (Vite + React + TypeScript, GitHub Pages via GitHub Actions)
**Depends on:** `docs/design/NETRICS-DESIGN.md` (FROZEN) — scoring engine, analytics, advisor, data model, and UI in v1 + Phase 3 + Phase 4 (box plot + time windows, frozen via PR #6) are unchanged by this doc. Phase 5 adds live Sleeper reads in two stages (5a runtime matchup fetch, 5b roster-change sync script). No scoring, analytics, advisor, or validator changes.

---

## 1. Problem & Phase 5 Scope

Every number in Netrics today comes from JSON files committed to the repo by hand. That is correct for verified game logs, but two things go stale between edits:

1. **The week scoreboard.** `weeks.json` stores `opponentPoints` as a snapshot with an `opponentAsOf` timestamp (Leg 3: `317.25` as of Nov 7, 1:24 PM ET). After every game night the opponent's total — and the user's own live total — move, and the Matchup view shows old numbers until someone edits the file.
2. **The roster.** Players get added and dropped (Jarace Walker was dropped in Leg 3). `players.json` and `weeks.json` only learn about it when someone notices and edits them by hand.

Phase 5 pulls live data from the Sleeper API (`https://api.sleeper.app/v1`, public, no auth) in two stages:

- **5a — Runtime live matchup (the main win):** the Matchup view fetches the current leg's matchup scores directly from Sleeper in the browser and shows live user/opponent totals, falling back to the stored snapshot when the fetch fails.
- **5b — Roster-change sync script:** an `npm run sync:sleeper` script that pulls rosters, transactions, and the players file and reports what changed versus the repo's JSON, for a human to review and commit. It never writes data files itself and never commits.

### What Sleeper cannot provide (verified Nov 7 — these stay out of Phase 5)
- **Per-game box scores do not exist in the Sleeper API.** There is no endpoint for single-game stat lines, so `game-logs.json` stays manually imported. Automating game-log ingestion needs a different source (e.g., the NBA stats API) and is a separate future design.
- **Weekly stats are empty for NBA.** `GET /v1/stats/nba/regular/{week}` returns all 1,852 players with empty `{}` objects for weeks 1, 2, and 3. It must not be used.
- **NBA schedules do not exist in the Sleeper API.** The schedules endpoint is NFL-only, so `remainingGames` stays manual (or from a schedule source, separate design).
- **No lock endpoint.** Sleeper never reports locks; `locks.json` stays the sole lock record (unchanged from Phase 3).

## 2. Verified Sleeper API Inventory (checked live Nov 7)

| Endpoint | Live? | Returns | Phase 5 use |
|---|---|---|---|
| `GET /v1/state/nba` | Yes | `week: 3, leg: 3, season: "2026"`, `season_start_date: "2026-10-20"`, `season_has_scores: true` | Current leg (5a, 5b) |
| `GET /v1/league/{id}/matchups/{leg}` | Yes | Per roster: `points`, `starters`, `starters_points`, `players_points` (per-player leg scores) | Live scoreboard (5a) |
| `GET /v1/league/{id}/rosters` | Yes | Per roster: `players`, `starters`, `reserve`, `settings` | Roster comparison (5b) |
| `GET /v1/league/{id}/transactions/{week}` | Yes | Adds/drops per roster (Leg 3: 48 transactions; roster 1 dropped `2563` Jarace Walker, added/dropped `4895`) | Roster-change detection (5b) |
| `GET /v1/league/{id}` | Yes | League settings, `scoring_settings`, status | Rarely-changing reference (5b, read-only) |
| `GET /v1/players/nba` | Yes | 2,176 players, ~2.5 MB (`full_name`, `team`, `position`, `status`, `injury_status`) | Team/position lookup on roster change (5b) |
| `GET /v1/stats/nba/regular/{week}` | No — all empty | 1,852 players, every entry `{}` | Must not be used |
| CORS | — | `access-control-allow-origin: *` on API responses | Browser fetch works with no proxy or key |

Two Sleeper quirks, recorded not fixed: the players file lists Walker Kessler's team as `LAL` (he plays for Utah) — that quirk is Sleeper's, and `players.json` already carries it; and Sleeper's live `players_points` can lag lock actions for hours (Phase 3 §2.4), so live scores are display-only and never feed locks or the advisor.

## 3. Stage 5a — Runtime Live Matchup (`src/ui/MatchupView.tsx` + new `src/sleeper/`)

A new pure-ish fetch module `src/sleeper/liveMatchup.ts` (fetch + parse only, no UI):

```ts
export interface LiveMatchup {
  leg: number;
  fetchedAt: string;            // ISO timestamp of the fetch
  userPoints: number;           // roster_id 1 `points` from matchups/{leg}
  opponentPoints: number;       // opponent roster `points`
  opponentPlayers: { sleeperId: string; points: number }[]; // opponent `players_points` for its starters, for the existing breakdown
  userPlayers: { sleeperId: string; points: number }[];     // roster 1 `players_points`, display only
}

export async function fetchLiveMatchup(leagueId: string, leg: number): Promise<LiveMatchup>;
// GET https://api.sleeper.app/v1/state/nba is NOT called here; the caller passes the leg from weeks.json.
// Throws on network error, non-200, or malformed payload. Never returns invented numbers.
```

Matchup view behavior:
- On opening the Matchup tab, fetch the live matchup for the selected leg (one request, no polling) and show a manual Refresh button for later checks.
- **Live wins when it arrives:** user total, opponent total, and margin come from the live fetch; the opponent starter breakdown comes from live `players_points`. A `Live · fetched <time>` label is shown.
- **Snapshot fallback:** while loading, and permanently if the fetch fails (offline, Sleeper down, bad payload), the view shows the stored `weeks.json` values with an `Offline · showing saved scores as of <opponentAsOf>` label. The view never shows a blank or a zero in place of a failed fetch.
- **Locks and advisor are untouched:** live `players_points` is never written into `locks.json`, never treated as a lock, and never fed into `evaluateLockDecision` / `evaluateMatchup` inputs. The advisor keeps using verified seed logs. Live data changes only what the scoreboard displays.
- **No new secrets or keys:** the Sleeper API is public; the fetch sends no auth, no user data, and no cookies.

## 4. Stage 5b — Roster-Change Sync Script (`scripts/sync-sleeper.ts`, `npm run sync:sleeper`)

A Node script (run by hand on the operator's machine, never in CI, never auto-committing) that fetches `state/nba`, `league/{id}/rosters`, `league/{id}/transactions/{current-week}`, and `players/nba`, then prints a report:

1. **Current leg** from `state/nba` vs the latest leg in `weeks.json`.
2. **Roster diffs:** for each rostered player in `players.json`, whether they are still on roster 1 in Sleeper, and any Sleeper roster players missing from `players.json` (with `full_name`, `team`, `position` from the players file). Adds/drops from the transactions endpoint are listed with dates, so a drop like Jarace Walker (`2563`, Leg 3) is explained, not just detected.
3. **Weeks diffs:** whether the current leg exists in `weeks.json`, and whether the stored `opponentPoints` differs from live (informational only — 5a already shows live scores; the script does not rewrite the snapshot).
4. **Exit code:** `0` when no differences, `1` when differences are found (so the operator notices), always printing the full report either way.

The script **never writes `data/*.json`** and never commits. The operator reviews the report, makes the edits (new `players.json` entries, new `weeks.json` leg, `rosterStatus: "former"` for dropped players with their logs kept), and commits through the normal PR process. This keeps the verified-data rule: no number enters the repo without a reviewed commit.

## 5. What Stays Unchanged

- Scoring engine, analytics, advisor, matchup math, bench swing: untouched. `evaluateMatchup` keeps taking `WeekRecord.opponentPoints` (the snapshot) as its input; the live values are a display layer on top, not a new input.
- `locks.json` remains the sole lock record. `game-logs.json` remains manual. `remainingGames` remains manual.
- `npm run validate && npm test && npm run build` gates unchanged. The sync script is covered by its own unit tests (report formatting and diff logic on fixture API responses, never live network in tests).

## 6. Phases

- **5a design (this PR):** this doc + ADR-0004, for Gemini blind review. 5a and 5b are designed together because they share the Sleeper inventory (§2) and the display-only principle, but they are built and reviewed as separate slices.
- **Freeze:** resolve the open questions below, then mark v1.0 FROZEN.
- **Build 5a first:** live matchup module + Matchup view changes + tests (including fetch-failure fallback and malformed-payload handling, using fixture responses), then a PR for Gemini review. **Build 5b next:** sync script + tests, then a PR for Gemini review.

## 7. Open Questions for Gemini + Product Owner

1. **Runtime fetch vs sync-script-only?** The draft recommends both (5a live display, 5b report script). Is the runtime fetch acceptable, or should all Sleeper data stay in committed files with the sync script as the only live touchpoint?
2. **Live `players_points` for the user's own starters — display in the Matchup view?** The draft shows the opponent breakdown from live data and the user's live total, but not per-starter live scores (those come from seed logs). Show the user's live per-player scores too, or keep the starter rows on verified logs only?
3. **Refresh behavior — fetch on open plus a Refresh button, no polling?** Acceptable, or should the view poll on a timer while open?
4. **Should 5b's report also propose `weeks.json` edits (a patch the operator applies), or stay a plain report?** A proposed patch is convenient but risks the operator applying numbers without checking them.
5. **Rate limits:** Sleeper asks clients to stay under roughly 1,000 requests per minute. One fetch per Matchup open is trivial, but should the module add a guard (e.g., no refetch within 60 seconds) so a Refresh-button spammer cannot hammer the API?
