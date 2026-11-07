# Netrics — Phase 6c Specification v0.1 (DRAFT)

**Status:** DRAFT — For Gemini blind review (same process as Phases 0, 3, 4, 5, 6: design v0.1 → Gemini review → revisions → freeze → build).
**Date:** 2026-11-07
**Authors:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)
**Repo:** `jpham197/netrics` (Vite + React + TypeScript, GitHub Pages via GitHub Actions)
**Depends on:** `docs/design/NETRICS-DESIGN.md` (FROZEN, including Phase 6b) — the ingestion script (`npm run ingest:espn`), the mapping file, and the reconciliation check are unchanged by this doc. Phase 6c adds one scheduled workflow (`.github/workflows/ingest-nightly.yml`) that runs the script and opens a pull request. No scoring, analytics, advisor, UI, or ingestion-script changes.

---

## 1. Problem & Phase 6c Scope

Phase 6b made game-log ingestion a hand-run script. Somebody still has to remember to run it after every game night. Phase 6c removes that step: a nightly job runs the script and opens a pull request with the proposed logs, so the only human action left is reviewing and merging.

### What Phase 6c is not
- Not auto-merge: the job never commits to `main` and never merges. The owner reviews and merges every PR, same as all other PRs.
- Not a change to the ingestion script: the script's behavior, flags, and reconciliation check are frozen in Phase 6b. This design only schedules it.
- Not a live/runtime feature: nothing changes in the site itself.

## 2. Schedule

- **Trigger:** GitHub Actions `schedule` cron `0 5 * * *` (UTC). GitHub Actions cron is UTC-only and has no timezone setting, so the run time shifts with daylight saving: **midnight EST (November–March), 1am EDT (March–November)**. The job is a batch run, not a live feed, so the one-hour seasonal shift does not change what it catches.
- **Why midnight, not earlier:** a run at midnight Eastern catches every game that finished before midnight. West Coast games that finish after midnight Eastern (a 10pm PT tip ends around 12:30am ET) are not yet Final, so they are skipped that night and picked up the next night (§3).

## 3. What the Job Does

1. **Check out the repo** and set up Node 22 with `npm ci`, the same setup as the existing CI workflow (`.github/workflows/ci.yml`).
2. **Compute the dates** in `America/New_York` at job time: yesterday and today. The job runs the script with a **2-day window** (`--date <yesterday> --date <today>`), so a late game skipped one night is caught the next. The overlap is harmless: the script already skips games that are already logged.
3. **Run the ingestion script** (`npm run ingest:espn -- --date <yesterday> --date <today> --out ingest-proposal.json`).
4. **If there are no proposed logs:** stop. No PR, no noise. A night with no new roster games produces nothing.
5. **If there are proposed logs:** create a branch (`ingest/YYYY-MM-DD`), apply the proposed logs to `data/game-logs.json` on that branch, run `npm run validate && npm test` on the branch, then open a pull request against `main` with the report as the PR body. Reconcile flags, if any, are called out at the top of the PR body and in the title, so the reviewer sees them before merging.
6. **If the script fails** (ESPN or Sleeper unreachable, bad payload): the job fails visibly in the Actions tab and opens no PR. A failed run is a signal, not a silent skip.

## 4. Permissions & the CI Gate

- The job uses the built-in `GITHUB_TOKEN` with `contents: write` and `pull-requests: write`. No secrets are needed: both ESPN and Sleeper are public, keyless APIs.
- **Known GitHub behavior:** a pull request opened with the built-in token does **not** trigger the repo's `pull_request` CI workflow. So the nightly workflow must run `npm run validate && npm test` on the branch itself **before** opening the PR — that run is the gate for these PRs, not CI. The reviewer still merges by hand.

## 5. What Stays Unchanged

- The ingestion script, mapping file, reconciliation check, scoring engine, analytics, advisor, UI, and live matchup fetch: untouched.
- The human-in-the-loop rule: no data lands on `main` without a reviewed, merged PR.
- `npm run validate && npm test && npm run build` gates unchanged.

## 6. Phases

- **6c design (this PR):** this doc + ADR-0006, for Gemini blind review.
- **Freeze:** resolve the open questions below, then mark v1.0 FROZEN.
- **6d build:** the workflow file (`.github/workflows/ingest-nightly.yml`) + tests for the date-window logic. Note: Muse cannot push files under `.github/workflows/` (GitHub integration 403), so the workflow file must be added by Gemini's push route.

## 7. Open Questions for Gemini + Product Owner

1. **Cron time — accept the DST shift?** `0 5 * * *` UTC is midnight EST / 1am EDT. Accept that, or pick a fixed UTC time that is midnight in one season and 11pm/1am in the other?
2. **2-day window vs yesterday-only?** The draft uses yesterday + today so late West Coast games are caught the next night. Is the overlap worth it, or should the job cover only yesterday and rely on the next night's run?
3. **Reconcile flags — open the PR or hold it?** The draft opens the PR with flags prominent in the title/body. Should a flag instead block the PR (job fails, human runs it by hand)?
4. **Validation gate — workflow validates on the branch (draft) vs a user access token so CI runs on the PR?** The draft avoids asking the owner to create and store a token. Is that the right trade?
5. **Branch and PR title format** — `ingest/YYYY-MM-DD` and a title like `data: ingest game logs for YYYY-MM-DD` (plus `⚠ reconcile` when flagged)? Any preferred format?
