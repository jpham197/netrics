// Validator — enforces every v1.0 §4 invariant. Returns a list of errors (empty = valid).
// Also enforces: asOf is YYYY-MM-DD, leagueId matches LEAGUE_ID, player IDs unique.

import { fantasyPoints } from "../scoring/index.js";
import { LEAGUE_ID, type GameLog, type PlayersFile } from "./types.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPPONENT_RE = /^(@?)([A-Z]{3})$/;
const NBA_TEAMS = new Set([
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
]);
const STAT_FIELDS = ["pts", "reb", "ast", "stl", "blk", "tov"] as const;
const OPTIONAL_STAT_FIELDS = ["tf", "ff"] as const;

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isValidDateString(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}

export function validatePlayers(file: PlayersFile): string[] {
  const errors: string[] = [];
  if (!isValidDateString(file.asOf)) errors.push(`players.asOf "${file.asOf}" must be a valid YYYY-MM-DD date`);
  if (file.leagueId !== LEAGUE_ID) {
    errors.push(`players.leagueId "${file.leagueId}" must be ${LEAGUE_ID}`);
  }
  if (!Array.isArray(file.players)) {
    errors.push("players.players must be an array");
    return errors;
  }
  const seen = new Set<string>();
  file.players.forEach((p, i) => {
    if (typeof p !== "object" || p === null) {
      errors.push(`players[${i}]: entry must be a non-null object`);
      return;
    }
    const where = `players[${i}] (${p.sleeperId ?? "?"})`;
    if (typeof p.sleeperId !== "string" || p.sleeperId === "") errors.push(`${where}: sleeperId must be a non-empty string`);
    else if (seen.has(p.sleeperId)) errors.push(`${where}: duplicate sleeperId ${p.sleeperId}`);
    else seen.add(p.sleeperId);
    if (typeof p.name !== "string" || p.name === "") errors.push(`${where}: name must be a non-empty string`);
    if (typeof p.team !== "string" || !NBA_TEAMS.has(p.team)) errors.push(`${where}: team must be a valid 3-letter NBA team code`);
    if (!Array.isArray(p.positions) || p.positions.length === 0) errors.push(`${where}: positions must be a non-empty array`);
    if (!["starter", "bench", "reserve"].includes(p.rosterStatus)) {
      errors.push(`${where}: rosterStatus must be starter | bench | reserve`);
    }
  });
  return errors;
}

export function validateGameLogs(logs: GameLog[], players: PlayersFile): string[] {
  const errors: string[] = [];
  const validPlayers = Array.isArray(players.players)
    ? players.players.filter((p): p is NonNullable<typeof p> => typeof p === "object" && p !== null)
    : [];
  const playerMap = new Map(validPlayers.map((p) => [p.sleeperId, p]));
  const seen = new Set<string>();
  const teamDateOpponent = new Map<string, { opponent: string; where: string }>();

  logs.forEach((log, i) => {
    if (typeof log !== "object" || log === null) {
      errors.push(`game-logs[${i}]: entry must be a non-null object`);
      return;
    }
    const where = `game-logs[${i}] (${log.sleeperId ?? "?"} ${log.date ?? "?"})`;
    const player = typeof log.sleeperId === "string" ? playerMap.get(log.sleeperId) : undefined;
    // Referential integrity
    if (!player) {
      errors.push(`${where}: sleeperId "${log.sleeperId}" is not in players.json`);
    }
    // Date format & valid calendar date
    const validDate = isValidDateString(log.date);
    if (!validDate) {
      errors.push(`${where}: date must be a valid YYYY-MM-DD calendar date`);
    }
    // Unique (sleeperId, date)
    const key = `${log.sleeperId}|${log.date}`;
    if (seen.has(key)) errors.push(`${where}: duplicate (sleeperId, date)`);
    else seen.add(key);
    // Opponent format, self-opponent check, and cross-player home/away symmetry
    const oppMatch = typeof log.opponent === "string" ? OPPONENT_RE.exec(log.opponent) : null;
    if (!oppMatch || !NBA_TEAMS.has(oppMatch[2] as string)) {
      errors.push(`${where}: opponent must be a valid NBA team code ("OPP" or "@OPP"), got ${JSON.stringify(log.opponent)}`);
    } else if (player && validDate) {
      const isAway = oppMatch[1] === "@";
      const oppTeam = oppMatch[2] as string;
      if (oppTeam === player.team) {
        errors.push(`${where}: opponent "${log.opponent}" cannot be player's own team (${player.team})`);
      } else {
        const ownKey = `${log.date}|${player.team}`;
        const existingSameTeam = teamDateOpponent.get(ownKey);
        if (existingSameTeam && existingSameTeam.opponent !== log.opponent) {
          errors.push(
            `${where}: teammate schedule conflict on ${log.date} for ${player.team} ("${log.opponent}" vs "${existingSameTeam.opponent}" at ${existingSameTeam.where})`,
          );
        } else {
          teamDateOpponent.set(ownKey, { opponent: log.opponent, where });
        }

        const oppKey = `${log.date}|${oppTeam}`;
        const existingOppTeam = teamDateOpponent.get(oppKey);
        const expectedOppString = isAway ? player.team : `@${player.team}`;
        if (existingOppTeam && existingOppTeam.opponent !== expectedOppString) {
          errors.push(
            `${where}: cross-player home/away mismatch on ${log.date}: ${player.team} has "${log.opponent}", but ${oppTeam} has "${existingOppTeam.opponent}" at ${existingOppTeam.where} (expected "${expectedOppString}")`,
          );
        }
      }
    }
    // Complete non-negative integer box scores
    for (const f of STAT_FIELDS) {
      if (!isNonNegativeInteger(log[f])) {
        errors.push(`${where}: ${f} must be a non-negative integer, got ${JSON.stringify(log[f])}`);
      }
    }
    for (const f of OPTIONAL_STAT_FIELDS) {
      if (log[f] !== undefined && !isNonNegativeInteger(log[f])) {
        errors.push(`${where}: ${f} must be a non-negative integer when present, got ${JSON.stringify(log[f])}`);
      }
    }
    // Mandatory provenance
    if (typeof log.source !== "string" || log.source.trim() === "") {
      errors.push(`${where}: source must be a non-empty string`);
    }
    // Derived-total cross-check (only when expectedTotal is present)
    if (log.expectedTotal !== undefined) {
      if (typeof log.expectedTotal !== "number" || !Number.isFinite(log.expectedTotal)) {
        errors.push(`${where}: expectedTotal must be a finite number when present`);
      } else if (STAT_FIELDS.every((f) => isNonNegativeInteger(log[f]))) {
        const computed = fantasyPoints(log).total;
        if (computed !== log.expectedTotal) {
          errors.push(
            `${where}: fantasyPoints total ${computed} !== expectedTotal ${log.expectedTotal}`,
          );
        }
      }
    }
  });
  return errors;
}

export function validateAll(players: PlayersFile, logs: GameLog[]): string[] {
  return [...validatePlayers(players), ...validateGameLogs(logs, players)];
}


