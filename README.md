# Netrics

Per-player spike & distribution analytics for Sleeper NBA Lock-In leagues (**Beltline Ballers**, `league_id: 1358656481750171649`).

Built around one principle: **spikes, not averages.**

## Documentation & Multi-Agent Index

Netrics follows an **Elephant-Goldfish** multi-agent workflow on GitHub (`Muse`, `Gemini`, and human review by `jiph`):

- [`AGENTS.md`](./AGENTS.md) — Rules and workflow every agent must follow before editing code or data.
- [`docs/design/NETRICS-DESIGN-v1.0.md`](./docs/design/NETRICS-DESIGN-v1.0.md) — **Frozen v1.0 specification** (scoring engine, data model, analytics math contracts, and v1 views).
- [`docs/reviews/2026-11-07-gemini-blind-review.md`](./docs/reviews/2026-11-07-gemini-blind-review.md) — Independent blind review of v0.1 and resolution log.
- [`docs/decisions/0001-v1-per-player-analytics-and-data-invariants.md`](./docs/decisions/0001-v1-per-player-analytics-and-data-invariants.md) — ADR 0001 covering v1 scope, box-score invariants, and multi-agent rules.
- [`docs/design/NETRICS-DESIGN-v0.1.md`](./docs/design/NETRICS-DESIGN-v0.1.md) — Original v0.1 draft preserved for history.

## Roadmap

- [x] **Phase 0:** v0.1 Draft → Gemini Blind Review → User Design Interview → Frozen `NETRICS-DESIGN-v1.0.md` + `AGENTS.md`
- [x] **Phase 1:** Pure scoring engine (`src/scoring/`), per-player analytics (`src/analytics/`), schema/math validator (`npm run validate`), unit tests, and verified 2026–27 seed data (`data/players.json`, `data/game-logs.json`)
- [x] **Phase 2:** Roster & Player Detail UI (`src/ui/`) + GitHub Pages deployment
- [ ] **Phase 3 (Deferred):** Lock advisor & weekly matchup views
- [ ] **Phase 4 (Deferred):** Automated Sleeper / box-score import scripts

## Commands

```bash
npm run validate   # Compile TypeScript and verify data/players.json + data/game-logs.json invariants
npm test           # Run Vitest unit & UI component tests
npm run dev        # Start local Vite dev server
npm run build      # Typecheck and build static production bundle into dist-web/
```