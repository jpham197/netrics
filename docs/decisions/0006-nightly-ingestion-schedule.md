# ADR-0006: Nightly Scheduled Ingestion via GitHub Actions

**Status:** Accepted
**Date:** 2026-11-07
**Deciders:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)

## Context

Phase 6b made game-log ingestion a hand-run script (`npm run ingest:espn`). Somebody still has to remember to run it after every game night. The remaining manual step is the schedule itself.

## Decision

Run the ingestion script on a nightly GitHub Actions schedule (`0 5 * * *` UTC — midnight EST, 1am EDT, plus `workflow_dispatch` for manual triggers) with a 2-day date window (`yesterday` and `today` in `America/New_York`), and open or update a pull request (`ingest/YYYY-MM-DD`) when new game logs are proposed:

1. **Schedule & 2-Day Window (`computeEasternDateWindow`):** Runs at `0 5 * * *` UTC and computes `[yesterday, today]` in `America/New_York`. Late West Coast games that finish after midnight Eastern are skipped as `not Final` that night and caught the following night; already-logged games are skipped idempotently.
2. **Branch Data Sync (`applyIngestionProposal`):** When `proposedLogs.length > 0`, on branch `ingest/YYYY-MM-DD` the job appends `proposedLogs` to `data/game-logs.json`, removes completed (`Final`) game dates from `WeekRecord.remainingGames` in `data/weeks.json` for all rostered players on teams whose game on that date finished, and advances `PlayersFile.asOf` in `data/players.json` to `max(asOf, maxProposedDate)` so `npm run validate` invariants and Player Detail time windows stay consistent.
3. **Reconcile Flags Surface in PR Title & Body:** When Sleeper reconciliation raises a `RECONCILE` flag (e.g., an unsplit flagrant or technical foul), the workflow still opens the PR with title `data: ingest game logs for YYYY-MM-DD (⚠ reconcile)` and places the `RECONCILE` flags at the top of the PR body for human review. Network or payload parse errors fail the workflow job visibly and open no PR.
4. **In-Workflow Validation Gate (`GITHUB_TOKEN`):** Because PRs opened with the built-in `GITHUB_TOKEN` do not trigger `pull_request` workflows, `.github/workflows/ingest-nightly.yml` runs `npm run validate && npm test && npm run build` directly on the `ingest/YYYY-MM-DD` branch before pushing and opening/updating the PR. The job never commits to `main` and never auto-merges.

## Rationale

- **GitHub Actions is the native home for the job:** the repo already runs CI and Pages deploys there, the runner has Node 22 and `npm ci` ready, and the schedule lives in the repo where both agents can see it.
- **Midnight Eastern with a 2-day window:** catches every game finished before midnight and picks up post-midnight West Coast games the next night without duplicates.
- **PR, not direct commit:** preserves the rule that no data lands on `main` without a reviewed, merged PR.
- **No external secrets:** uses built-in `GITHUB_TOKEN` (`contents: write`, `pull-requests: write`) and public keyless ESPN + Sleeper endpoints.

## Consequences

- One new workflow file (`.github/workflows/ingest-nightly.yml`) plus pure helpers (`computeEasternDateWindow`, `applyIngestionProposal`, `buildNightlyPrMetadata`) in `src/espn/ingest.ts` tested in `src/espn/ingest.test.ts`.
- Worked-example unit tests (`boxplot.test.ts`, `advisor.test.ts`, `LockAdvisorView.test.tsx`, `PlayerDetail.test.tsx`) filter seed logs to `date <= "2026-11-06"` so `npm test` remains deterministic as `data/game-logs.json` grows across the season.
