// Runtime data loading for the browser app.
//
// The UI fetches data/players.json and data/game-logs.json at runtime
// (relative URLs, so it works at the domain root and under /netrics/ on
// GitHub Pages). The files are the repo's data/*.json — copied into the
// Vite output by the plugin in vite.config.ts, never duplicated by hand.
// Shape is checked here; the full invariant checks live in src/data and
// run via `npm run validate`. This module never reads expectedTotal.

import type { GameLog, PlayersFile } from "../data/types.js";

export interface RosterData {
  players: PlayersFile;
  logs: GameLog[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function fetchRosterData(): Promise<RosterData> {
  const [playersRes, logsRes] = await Promise.all([
    fetch("data/players.json"),
    fetch("data/game-logs.json"),
  ]);
  if (!playersRes.ok) throw new Error(`players.json failed to load (${playersRes.status})`);
  if (!logsRes.ok) throw new Error(`game-logs.json failed to load (${logsRes.status})`);
  const players = (await playersRes.json()) as unknown;
  const logs = (await logsRes.json()) as unknown;
  if (!isRecord(players) || typeof players.asOf !== "string" || !Array.isArray(players.players)) {
    throw new Error("players.json has an unexpected shape");
  }
  if (!Array.isArray(logs)) {
    throw new Error("game-logs.json has an unexpected shape");
  }
  return { players: players as unknown as PlayersFile, logs: logs as GameLog[] };
}
