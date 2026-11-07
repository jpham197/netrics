// `npm run sync:sleeper` CLI — Stage 5b Read-Only Roster & Week Sync (`docs/design/NETRICS-DESIGN.md` §8.3).
// Fetches live Sleeper state, rosters, transactions, matchups, and player metadata (when needed),
// compares against local `data/players.json` and `data/weeks.json`, prints a human-readable
// diff report, and exits with code 1 when actionable diffs exist or 0 when in sync.
// NEVER writes `data/*.json` and NEVER calls `/v1/stats/nba/regular/{week}`.

import { resolve } from "node:path";
import { loadPlayers, loadWeeks } from "../data/load.js";
import { LEAGUE_ID } from "../data/types.js";
import {
  buildSyncReport,
  type SleeperNbaState,
  type SleeperPlayerMeta,
  type SleeperRosterEntry,
  type SleeperTransactionEntry,
} from "./syncReport.js";

const BASE_URL = "https://api.sleeper.app/v1";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  const playersPath = resolve(process.argv[2] ?? "data/players.json");
  const weeksPath = resolve(process.argv[3] ?? "data/weeks.json");

  const playersFile = loadPlayers(playersPath);
  const weeksFile = loadWeeks(weeksPath);

  const state = await fetchJson<SleeperNbaState>(`${BASE_URL}/state/nba`);
  const leg = state.leg ?? state.week ?? 1;

  const [rosters, transactions, matchups, sleeperPlayers] = await Promise.all([
    fetchJson<SleeperRosterEntry[]>(`${BASE_URL}/league/${LEAGUE_ID}/rosters`),
    fetchJson<SleeperTransactionEntry[]>(`${BASE_URL}/league/${LEAGUE_ID}/transactions/${leg}`),
    fetchJson<unknown>(`${BASE_URL}/league/${LEAGUE_ID}/matchups/${leg}`),
    fetchJson<Record<string, SleeperPlayerMeta>>(`${BASE_URL}/players/nba`),
  ]);

  const report = buildSyncReport({
    state,
    rosters,
    transactions,
    matchups,
    sleeperPlayers,
    playersFile,
    weeksFile,
  });

  console.log(report.textReport);
  process.exitCode = report.hasActionableDiffs ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(`sync:sleeper FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
