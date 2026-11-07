# Netrics

Per-player spike & distribution analytics for Sleeper NBA Lock-In leagues (**Beltline Ballers**, `league_id: 1358656481750171649`).

Built around one principle: **spikes, not averages.**

## Documentation & Multi-Agent Index

Netrics follows an **Elephant-Goldfish** multi-agent workflow on GitHub (`Muse`, `Gemini`, and human review by `jiph`):

- [`AGENTS.md`](./AGENTS.md) — Rules and workflow every agent must follow before editing code or data.
- [`docs/design/NETRICS-DESIGN.md`](./docs/design/NETRICS-DESIGN.md) — **Canonical frozen specification** (scoring engine, data model, per-player analytics, Lock Advisor EV math, Weekly Matchup bounds, Bench Swing, and UI views).
- [`docs/reviews/2026-11-07-gemini-blind-review.md`](./docs/reviews/2026-11-07-gemini-blind-review.md) — Independent blind review of Phase 0 v0.1 and resolution log.
- [`docs/reviews/2026-11-07-gemini-phase3-review.md`](./docs/reviews/2026-11-07-gemini-phase3-review.md) — Independent blind review of Phase 3 v0.1 and resolution log.
- [`docs/decisions/0001-v1-per-player-analytics-and-data-invariants.md`](./docs/decisions/0001-v1-per-player-analytics-and-data-invariants.md) — ADR 0001 covering v1 scope, box-score invariants, and multi-agent rules.
- [`docs/decisions/0002-phase3-lock-record-and-advisor-ev.md`](./docs/decisions/0002-phase3-lock-record-and-advisor-ev.md) — ADR 0002 covering `data/locks.json` provenance and distribution-grounded Lock Advisor EV.

## Roadmap

- [x] **Phase 0:** v0.1 Draft → Gemini Blind Review → User Design Interview → Frozen design specification + `AGENTS.md`
- [x] **Phase 1:** Pure scoring engine (`src/scoring/`), per-player analytics (`src/analytics/`), schema/math validator (`npm run validate`), unit tests, and verified 2026–27 seed data (`data/players.json`, `data/game-logs.json`)
- [x] **Phase 2:** Roster & Player Detail UI (`src/ui/`) + GitHub Pages deployment
- [x] **Phase 3:** Lock Advisor, Weekly Matchup, and Bench Swing engine (`src/advisor/`), `data/weeks.json` & `data/locks.json`, and UI views
- [ ] **Phase 4 (Deferred):** Automated Sleeper / box-score import scripts

## Commands

```bash
npm run validate   # Compile TypeScript and verify data/players.json, data/game-logs.json, data/weeks.json, and data/locks.json invariants
npm test           # Run Vitest unit & UI component tests
npm run dev        # Start local Vite dev server
npm run build      # Typecheck and build static production bundle into dist-web/
```