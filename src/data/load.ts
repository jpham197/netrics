// Loaders for data/players.json, data/game-logs.json, data/weeks.json, and data/locks.json
// (spec v1.0 §4 & Phase 3 v1.0 §3).
// Loaders do structural parsing only; invariant checks live in validate.ts.

import { readFileSync } from "node:fs";
import type { GameLog, LocksFile, PlayersFile, WeeksFile } from "./types.js";

export function loadPlayers(path: string): PlayersFile {
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

export function loadGameLogs(path: string): GameLog[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`game-logs file at ${path} must be a JSON array`);
  }
  return raw as GameLog[];
}

export function loadWeeks(path: string): WeeksFile {
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

export function loadLocks(path: string): LocksFile {
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

export function loadAll(
  playersPath = "data/players.json",
  logsPath = "data/game-logs.json",
  weeksPath = "data/weeks.json",
  locksPath = "data/locks.json",
): {
  players: PlayersFile;
  logs: GameLog[];
  weeks: WeeksFile;
  locks: LocksFile;
} {
  return {
    players: loadPlayers(playersPath),
    logs: loadGameLogs(logsPath),
    weeks: loadWeeks(weeksPath),
    locks: loadLocks(locksPath),
  };
}
