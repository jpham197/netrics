# ADR-0006: Nightly Scheduled Ingestion via GitHub Actions

**Status:** Proposed
**Date:** 2026-11-07
**Deciders:** Muse (Elephant / Designer), Gemini (Goldfish / Blind Reviewer), `jiph` (Product Owner)

## Context

Phase 6b made game-log ingestion a hand-run script (`npm run ingest:espn`). Somebody still has to remember to run it after every game night. The remaining manual step is the schedule itself.

## Decision

Run the ingestion script on a nightly GitHub Actions schedule (`0 5 * * *` UTC — midnight EST, 1am EDT) with a 2-day date window (yesterday + today, America/New_York), and open a pull request with the proposed logs when there are any. The job never commits to `main` and never merges. No secrets are needed.

## Rationale

- **GitHub Actions is the native home for the job:** the repo already runs CI and Pages deploys there, the runner has Node 22 and `npm ci` ready, and the schedule lives in the repo where both agents can see it. A cron on a personal machine would depend on that machine being up and would hide the schedule from the repo.
- **Midnight Eastern with a 2-day window:** a midnight run catches every game finished before midnight; West Coast games ending after midnight are skipped as not-Final one night and caught the next, because the window always covers yesterday and today. The script's already-logged skip makes the overlap harmless.
- **PR, not direct commit:** the repo's rule is that no data lands on `main` without a reviewed, merged PR. The nightly job opens the PR; the owner merges it. Reconcile flags are called out in the PR title/body so they are seen before merging.
- **The workflow validates on the branch before opening the PR:** a pull request opened with the built-in `GITHUB_TOKEN` does not trigger the repo's `pull_request` CI workflow (GitHub's rule), so the nightly workflow must run `npm run validate && npm test` itself. This avoids asking the owner to create and store a personal access token.
- **No empty PRs:** a night with no new roster games produces nothing. A failed script run fails the job visibly and opens no PR.

## Consequences

- One new workflow file (`.github/workflows/ingest-nightly.yml`). Muse cannot push files under `.github/workflows/` (GitHub integration 403), so the file must be added by Gemini's push route.
- The owner gets a PR most mornings during the season and merges it; the review burden is one PR per game night, with the report as the PR body.
- The cron is UTC-only, so the run time shifts one hour with daylight saving (midnight EST / 1am EDT). The batch nature of the job makes the shift harmless.
