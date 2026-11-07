// Loaders for data/players.json, data/game-logs.json, data/weeks.json, data/locks.json,
// and data/espn-player-map.json (spec v1.0 §4, Phase 3 v1.0 §3, & Phase 6 v1.0 §4/§9).
// Loaders do structural parsing only; invariant checks live in validate.ts.

import { readFileSync } from "node:fs";
import type {
  EspnPlayerMapFile,
  GameLog,
  LocksFile,
  PlayersFile,
  WeeksFile,
} from "./types.js";

export function loadPlayers(path = "data/players.json"): PlayersFile {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`players file at ${path} must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.asOf !== "string" || typeof obj.leagueId !== "string" || !Array.isArray(obj.players)) {
    throw new Error(`players file at ${path} must have asOf (string), leagueId (string), players (array)`);
  }
  return raw as PlayersFile;
}

export function loadGameLogs(path = "data/game-logs.json"): GameLog[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`game-logs file at ${path} must be a JSON array`);
  }
  return raw as GameLog[];
}

export function loadWeeks(path = "data/weeks.json"): WeeksFile {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`weeks file at ${path} must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.leagueId !== "string" || !Array.isArray(obj.weeks)) {
    throw new Error(`weeks file at ${path} must have leagueId (string), weeks (array)`);
  }
  return raw as WeeksFile;
}

export function loadLocks(path = "data/locks.json"): LocksFile {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`locks file at ${path} must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.leagueId !== "string" || !Array.isArray(obj.locks)) {
    throw new Error(`locks file at ${path} must have leagueId (string), locks (array)`);
  }
  return raw as LocksFile;
}

export function loadEspnPlayerMap(path = "data/espn-player-map.json"): EspnPlayerMapFile {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`espn-player-map file at ${path} must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.leagueId !== "string" || !Array.isArray(obj.players)) {
    throw new Error(`espn-player-map file at ${path} must have leagueId (string), players (array)`);
  }
  return raw as EspnPlayerMapFile;
}

export function loadAll(
  playersPath = "data/players.json",
  logsPath = "data/game-logs.json",
  weeksPath = "data/weeks.json",
  locksPath = "data/locks.json",
  espnPlayerMapPath = "data/espn-player-map.json",
): {
  players: PlayersFile;
  logs: GameLog[];
  weeks: WeeksFile;
  locks: LocksFile;
  espnPlayerMap: EspnPlayerMapFile;
} {
  return {
    players: loadPlayers(playersPath),
    logs: loadGameLogs(logsPath),
    weeks: loadWeeks(weeksPath),
    locks: loadLocks(locksPath),
    espnPlayerMap: loadEspnPlayerMap(espnPlayerMapPath),
  };
}

export const loadAllData = loadAll;

