// Loaders for data/players.json and data/game-logs.json (spec v1.0 §4).
// Loaders do structural parsing only; invariant checks live in validate.ts.

import { readFileSync } from "node:fs";
import type { GameLog, PlayersFile } from "./types.js";

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
