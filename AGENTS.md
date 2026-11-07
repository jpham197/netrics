# AGENTS.md — Elephant-Goldfish Multi-Agent Protocol for Netrics

This repository (`jpham197/netrics`) is developed collaboratively by multiple AI agents (including **Muse** and **Gemini**) paired with the repository owner (`jiph`) under the **Elephant-Goldfish Model**.

Every agent working in this repository MUST read and follow these rules before modifying any file.

---

## 1. The Elephant-Goldfish Model

Multi-agent collaboration fails when agents rely on unshared chat memory or silently "correct" data from pre-training memory. Netrics solves this by separating roles and making the GitHub repository the single source of truth:

- **The Elephant (Longitudinal Context & Designer — e.g., Muse):**
  - Holds long-horizon product context across user sessions.
  - Externalizes every requirement, verified fact, and correction into committed repo files (`docs/design/`, `docs/decisions/`, `data/`).
  - **Rule:** If a fact is only in chat memory and not in this repo with a `source`, it does not exist to other agents.
- **The Goldfish (Stateless Verifier & Builder — e.g., Gemini):**
  - Evaluates designs, data, and code with zero reliance on unverified chat history.
  - Trusts **only** what is specified in `docs/design/NETRICS-DESIGN-v1.0.md`, `docs/decisions/`, sourced `data/*.json` files, unit tests (`npm test`), and schema/math validation (`npm run validate`).
  - Rejects or flags any unsourced number, silent assumption, or scope creep.

---

## 2. Canonical Documentation Map

Before starting any task, inspect:
1. **`docs/design/NETRICS-DESIGN-v1.0.md`** — Frozen v1 specification (scoring rules, TypeScript schemas, analytics math contracts, and UI views).
2. **`docs/decisions/`** — Architecture Decision Records (ADRs). Never change data schemas, scoring rules, or v1 scope without adding a new ADR and updating the design doc.
3. **`docs/reviews/`** — Independent design and phase reviews so all agents can see what was challenged and resolved.

---

## 3. Non-Negotiable Engineering & Data Rules

1. **Spikes, Not Averages:**
   - Never present a season mean or projection as a player's ceiling or decision target.
   - `mean` may only appear in Player Detail labelled as `Mean (ref only)`.
2. **Pure Scoring Engine (`src/scoring/`):**
   - `fantasyPoints(g: GameLog)` is the **sole** place fantasy points are calculated.
   - Any change to `src/scoring/` requires a failing-then-passing unit test derived from a real, sourced box-score line in `docs/design/NETRICS-DESIGN-v1.0.md` §3.
   - The 6-part `ScoreBreakdown` (`scoring + rebounds + playmaking + stocks + bonuses + penalties`) must always sum exactly to `total`.
3. **Strict Data Provenance (`data/players.json`, `data/game-logs.json`):**
   - **Never invent, guess, or "fix" stats or team abbreviations from pre-training memory.**
   - Every `GameLog` in `data/game-logs.json` must include full single-game box-score stats (`pts, reb, ast, stl, blk, tov`), a non-empty `source` string, and unique `(sleeperId, date)`.
   - Never store multi-game weekly totals in `data/game-logs.json`.
   - When `expectedTotal` is provided on a `GameLog`, `npm run validate` must verify `fantasyPoints(log).total === log.expectedTotal`. UI and analytics code must **never** read `expectedTotal`.
4. **v1 Scope Discipline:**
   - v1 is **per-player analytics only** (Roster view + Player Detail view).
   - Do **not** build Lock Advisor, Week Matchup, or Bench Swing views, and do **not** add `weeks.json` or `locks.json` in v1 (deferred to Phase 3).
5. **Git & PR Workflow:**
   - Work in small, focused branches/PRs (one feature or phase slice per PR) once Phase 1 code begins.
   - Every PR must pass `npm run validate`, `npm test`, and `npm run build` in GitHub Actions CI before merge.

---

## 4. Communication & Explanation Style

- When explaining a concept to the user (`jiph`), always use **technical layman terms** — plain, concrete, direct descriptions of what the code, data, or mechanism actually does.
- **Never use analogies or metaphors.** Explain the real mechanics directly without figurative comparisons.

