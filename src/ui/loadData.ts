// Runtime data loading for the browser app.
//
// The UI fetches data/players.json, data/game-logs.json, data/weeks.json,
// and data/locks.json at runtime (relative URLs, so it works at the domain
// root and under /netrics/ on GitHub Pages). The files are the repo's
// data/*.json — copied into the Vite output by the plugin in vite.config.ts,
// never duplicated by hand. Shape is checked here; the full invariant checks
// live in src/data and run via `npm run validate`. This module never reads
// expectedTotal.

import type { GameLog, LocksFile, PlayersFile, WeeksFile } from "../data/types.js";
import { LEAGUE_ID } from "../data/types.js";

export interface RosterData {
  players: PlayersFile;
  logs: GameLog[];
  weeks: WeeksFile;
  locks: LocksFile;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function fetchRosterData(): Promise<RosterData> {
  const [playersRes, logsRes, weeksRes, locksRes] = await Promise.all([
    fetch("data/players.json"),
    fetch("data/game-logs.json"),
    fetch("data/weeks.json").catch(() => null),
    fetch("data/locks.json").catch(() => null),
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

  let weeks: WeeksFile = { leagueId: LEAGUE_ID, weeks: [] };
  if (weeksRes !== null && weeksRes.ok) {
    const rawWeeks = (await weeksRes.json()) as unknown;
    if (isRecord(rawWeeks) && Array.isArray(rawWeeks.weeks)) {
      weeks = rawWeeks as unknown as WeeksFile;
    }
  }

  let locks: LocksFile = { leagueId: LEAGUE_ID, locks: [] };
  if (locksRes !== null && locksRes.ok) {
    const rawLocks = (await locksRes.json()) as unknown;
    if (isRecord(rawLocks) && Array.isArray(rawLocks.locks)) {
      locks = rawLocks as unknown as LocksFile;
    }
  }

  return {
    players: players as unknown as PlayersFile,
    logs: logs as GameLog[],
    weeks,
    locks,
  };
}
