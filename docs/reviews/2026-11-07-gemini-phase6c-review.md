# Gemini Independent Blind Review — Phase 6c Design v0.1 (`phase-6c/design-v0.1`)

**Reviewer:** Gemini (Goldfish / Stateless Verifier & Senior Software Engineer)
**Date:** 2026-11-07
**Reviewed Artifacts:** `docs/design/NETRICS-DESIGN-PHASE6C-v0.1.md` and `docs/decisions/0006-nightly-ingestion-schedule.md` (commit `9edd7f3`)
**Outcome:** All engineering findings and open product questions resolved with `jiph` and frozen into `docs/design/NETRICS-DESIGN.md` (§9.5) and `docs/decisions/0006-nightly-ingestion-schedule.md`.

---

## 1. Engineering & Validation Gate Findings

1. **`validateWeeks` & `players.asOf` Invariants When Applying Proposed Logs on a PR Branch:**
   - **Finding:** Draft §3 step 5 stated that the workflow applies proposed logs to `data/game-logs.json` on the `ingest/YYYY-MM-DD` branch and runs `npm run validate && npm test`. However, `validateWeeks` in `src/data/validate.ts` enforces two cross-file invariants:
     1. No date in `WeekRecord.remainingGames[sleeperId]` may already exist as a played `(sleeperId, date)` in `data/game-logs.json`.
     2. Active (non-`reserve`) teammates on the same NBA team must share identical `remainingGames` schedules in that week (so if one teammate plays and another is DNP in a completed game on date `D`, `D` must be removed from `remainingGames` for all players on that team).
     Additionally, `PlayersFile.asOf` anchors the trailing time windows in Player Detail (`last-week`, `last-3-weeks`, `last-month`); leaving `asOf` behind `max(proposedLogs.date)` would hide newly ingested games from the time windows.
   - **Resolution:** Added a pure `applyIngestionProposal` function in `src/espn/ingest.ts` (invoked by the workflow on the `ingest/YYYY-MM-DD` branch) that:
     - Appends new `proposedLogs` to `data/game-logs.json`.
     - Removes completed (`Final`) game dates `(team, date)` from `WeekRecord.remainingGames` in `data/weeks.json` for all rostered players on teams whose game on `date` is `Final`.
     - Advances `PlayersFile.asOf` in `data/players.json` to `max(playersFile.asOf, maxProposedDate)`.
2. **Deterministic Snapshot Filtering in Worked-Example Unit Tests:**
   - **Finding:** Worked-example tests in `src/analytics/boxplot.test.ts`, `src/advisor/advisor.test.ts`, `src/ui/LockAdvisorView.test.tsx`, and `src/ui/PlayerDetail.test.tsx` loaded `data/game-logs.json` and `data/weeks.json` without filtering to the `2026-11-06` seed snapshot (`N = 10` for Kessler). Appending any game on or after `2026-11-07` on a nightly PR branch would cause `npm test` to fail on those worked examples.
   - **Resolution:** Pinned the worked-example unit tests to the `2026-11-06` snapshot (`l.date <= "2026-11-06"` and Leg 3 remaining schedule after `2026-11-06`), matching `src/analytics/analytics.test.ts`, while `npm run validate` and `src/data/validate.test.ts` validate the full growing dataset.
3. **Distinguishing Network/Parse Failures from `RECONCILE` Warnings in the Nightly Workflow:**
   - **Finding:** In interactive CLI mode (`npm run ingest:espn`), `RECONCILE` flags exit `1` to alert the operator. In the nightly workflow, the desired behavior is to **open the PR** when `proposedLogs.length > 0` even if `RECONCILE` flags are present (calling them out with `⚠ reconcile` in the PR title and body), while failing the workflow job without a PR only when network fetches or payload parsing fail.
   - **Resolution:** Added `--allow-reconcile-flags` and `--apply-to-data` (for the PR branch step) to `src/espn/ingest-cli.ts` so network/parse errors exit `1` and abort before PR creation, while `RECONCILE` flags are written to a structured summary/body file and surfaced in the PR title (`data: ingest game logs for YYYY-MM-DD (⚠ reconcile)`) and top of the PR body.

---

## 2. Resolution of Open Design Questions (Confirmed with `jiph`)

1. **Q1 (Cron & Date Window):** Run nightly at `0 5 * * *` UTC (midnight EST / 1am EDT) with a 2-day `America/New_York` window (`yesterday` and `today`) plus `workflow_dispatch` for manual runs.
2. **Q2 (Reconcile Flags):** Still open the PR when `RECONCILE` flags are raised, prefixing/annotating the PR title with `⚠ reconcile` and placing the flags at the top of the PR body; fail the job with no PR only on network/parse errors.
3. **Q3 (Data Sync & Test Gate):** Update `data/game-logs.json`, `data/weeks.json` (`remainingGames`), and `data/players.json` (`asOf`) together on the PR branch, and pin worked-example tests to `date <= 2026-11-06`.
4. **Q4 (Token & Naming):** Use built-in `GITHUB_TOKEN` (`contents: write`, `pull-requests: write`), run `npm run validate && npm test && npm run build` inside the workflow on branch `ingest/YYYY-MM-DD`, and open/update PR `data: ingest game logs for YYYY-MM-DD` (plus `⚠ reconcile` when flagged).
