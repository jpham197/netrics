// Validator — enforces every v1.0 §4 and Phase 3 v1.0 §3.1 invariant.
// Returns a list of errors (empty = valid).
// Also enforces: asOf is YYYY-MM-DD, leagueId matches LEAGUE_ID, player IDs unique,
// weeks/locks referential integrity, slot eligibility, and lock-to-log total consistency.

import { fantasyPoints } from "../scoring/index.js";
import {
  LEAGUE_ID,
  STARTER_SLOTS,
  type GameLog,
  type LocksFile,
  type PlayersFile,
  type StarterSlot,
  type WeeksFile,
} from "./types.js";

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

export function isPositionEligibleForSlot(positions: string[], slot: StarterSlot | string): boolean {
  if (slot === "UTIL") return true;
  if (slot === "G") return positions.includes("PG") || positions.includes("SG");
  if (slot === "F") return positions.includes("SF") || positions.includes("PF");
  return positions.includes(slot);
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

export function validateWeeks(weeksFile: WeeksFile, players: PlayersFile, logs: GameLog[]): string[] {
  const errors: string[] = [];
  if (weeksFile.leagueId !== LEAGUE_ID) {
    errors.push(`weeks.leagueId "${weeksFile.leagueId}" must be ${LEAGUE_ID}`);
  }
  if (!Array.isArray(weeksFile.weeks)) {
    errors.push("weeks.weeks must be an array");
    return errors;
  }

  const validPlayers = Array.isArray(players.players)
    ? players.players.filter((p): p is NonNullable<typeof p> => typeof p === "object" && p !== null)
    : [];
  const playerMap = new Map(validPlayers.map((p) => [p.sleeperId, p]));
  const playedLogKeys = new Set(
    logs
      .filter((l): l is NonNullable<typeof l> => typeof l === "object" && l !== null)
      .map((l) => `${l.sleeperId}|${l.date}`),
  );
  const seenLegs = new Set<number>();

  weeksFile.weeks.forEach((week, i) => {
    if (typeof week !== "object" || week === null) {
      errors.push(`weeks[${i}]: entry must be a non-null object`);
      return;
    }
    const where = `weeks[${i}] (leg ${week.leg ?? "?"})`;
    if (!isNonNegativeInteger(week.leg) || week.leg <= 0) {
      errors.push(`${where}: leg must be a positive integer`);
    } else if (seenLegs.has(week.leg)) {
      errors.push(`${where}: duplicate leg ${week.leg}`);
    } else {
      seenLegs.add(week.leg);
    }

    const validStart = isValidDateString(week.startDate);
    const validEnd = isValidDateString(week.endDate);
    if (!validStart) {
      errors.push(`${where}: startDate "${week.startDate}" must be a valid YYYY-MM-DD date`);
    }
    if (!validEnd) {
      errors.push(`${where}: endDate "${week.endDate}" must be a valid YYYY-MM-DD date`);
    }
    if (validStart && validEnd && week.startDate > week.endDate) {
      errors.push(`${where}: startDate "${week.startDate}" must be <= endDate "${week.endDate}"`);
    }

    if (!isNonNegativeInteger(week.matchupId) || week.matchupId < 1 || week.matchupId > 6) {
      errors.push(`${where}: matchupId must be an integer in 1..6 (12-team league), got ${JSON.stringify(week.matchupId)}`);
    }
    if (!isNonNegativeInteger(week.opponentRosterId) || week.opponentRosterId < 2 || week.opponentRosterId > 12) {
      errors.push(
        `${where}: opponentRosterId must be an integer in 2..12 (cannot be user roster_id 1 or > 12), got ${JSON.stringify(week.opponentRosterId)}`,
      );
    }
    if (typeof week.opponentName !== "string" || week.opponentName.trim() === "") {
      errors.push(`${where}: opponentName must be a non-empty string`);
    }
    if (typeof week.opponentPoints !== "number" || !Number.isFinite(week.opponentPoints) || week.opponentPoints < 0) {
      errors.push(`${where}: opponentPoints must be a finite non-negative number`);
    }
    if (typeof week.opponentAsOf !== "string" || week.opponentAsOf.trim() === "") {
      errors.push(`${where}: opponentAsOf must be a non-empty string`);
    }
    if (week.opponentRemainingGames !== undefined && !isNonNegativeInteger(week.opponentRemainingGames)) {
      errors.push(`${where}: opponentRemainingGames must be a non-negative integer when present`);
    }
    if (week.opponentPlayers !== undefined) {
      if (!Array.isArray(week.opponentPlayers)) {
        errors.push(`${where}: opponentPlayers must be an array when present`);
      } else {
        week.opponentPlayers.forEach((op, opIdx) => {
          if (typeof op !== "object" || op === null) {
            errors.push(`${where}: opponentPlayers[${opIdx}] must be a non-null object`);
            return;
          }
          if (typeof op.name !== "string" || op.name.trim() === "") {
            errors.push(`${where}: opponentPlayers[${opIdx}].name must be a non-empty string`);
          }
          if (typeof op.points !== "number" || !Number.isFinite(op.points)) {
            errors.push(`${where}: opponentPlayers[${opIdx}].points must be a finite number`);
          }
        });
      }
    }

    if (!Array.isArray(week.starters) || week.starters.length !== STARTER_SLOTS.length) {
      errors.push(`${where}: starters must have exactly ${STARTER_SLOTS.length} entries, got ${Array.isArray(week.starters) ? week.starters.length : "non-array"}`);
    }
    if (!Array.isArray(week.bench) || week.bench.length > 6) {
      errors.push(`${where}: bench must be an array of at most 6 entries`);
    }
    if (!Array.isArray(week.reserve) || week.reserve.length > 2) {
      errors.push(`${where}: reserve must be an array of at most 2 entries`);
    }

    const seenInWeek = new Set<string>();
    const checkRosterGroup = (ids: unknown, groupName: string) => {
      if (!Array.isArray(ids)) return;
      ids.forEach((id, idx) => {
        if (typeof id !== "string" || id === "") {
          errors.push(`${where}: ${groupName}[${idx}] must be a non-empty sleeperId string`);
          return;
        }
        if (seenInWeek.has(id)) {
          errors.push(`${where}: duplicate player "${id}" across starters/bench/reserve`);
        } else {
          seenInWeek.add(id);
        }
        const player = playerMap.get(id);
        if (!player) {
          errors.push(`${where}: ${groupName}[${idx}] sleeperId "${id}" is not in players.json`);
        } else if (groupName === "starters" && idx < STARTER_SLOTS.length) {
          const slot = STARTER_SLOTS[idx] as StarterSlot;
          if (!isPositionEligibleForSlot(player.positions, slot)) {
            errors.push(
              `${where}: starter "${id}" (${player.name}, [${player.positions.join(",")}]) is ineligible for slot ${slot} at starters[${idx}]`,
            );
          }
        }
      });
    };

    checkRosterGroup(week.starters, "starters");
    checkRosterGroup(week.bench, "bench");
    checkRosterGroup(week.reserve, "reserve");

    if (typeof week.remainingGames !== "object" || week.remainingGames === null || Array.isArray(week.remainingGames)) {
      errors.push(`${where}: remainingGames must be a non-null object map`);
    } else {
      const reserveSet = new Set(Array.isArray(week.reserve) ? week.reserve : []);
      const teamRemainingSchedule = new Map<string, { sleeperId: string; datesKey: string }>();

      for (const rosteredId of seenInWeek) {
        if (!(rosteredId in week.remainingGames)) {
          errors.push(`${where}: rostered player "${rosteredId}" is missing an entry in remainingGames`);
        }
      }

      for (const [sleeperId, dates] of Object.entries(week.remainingGames)) {
        const player = playerMap.get(sleeperId);
        if (!player) {
          errors.push(`${where}: remainingGames key "${sleeperId}" is not in players.json`);
        }
        if (!Array.isArray(dates)) {
          errors.push(`${where}: remainingGames["${sleeperId}"] must be an array of date strings`);
          continue;
        }
        const seenDates = new Set<string>();
        dates.forEach((d, dIdx) => {
          if (!isValidDateString(d)) {
            errors.push(`${where}: remainingGames["${sleeperId}"][${dIdx}] "${d}" must be a valid YYYY-MM-DD date`);
            return;
          }
          if (seenDates.has(d)) {
            errors.push(`${where}: remainingGames["${sleeperId}"] has duplicate date "${d}"`);
          } else {
            seenDates.add(d);
          }
          if (dIdx > 0 && isValidDateString(dates[dIdx - 1]) && d < (dates[dIdx - 1] as string)) {
            errors.push(
              `${where}: remainingGames["${sleeperId}"] dates must be in ascending order ("${dates[dIdx - 1]}" before "${d}")`,
            );
          }
          if (validStart && validEnd && (d < week.startDate || d > week.endDate)) {
            errors.push(
              `${where}: remainingGames["${sleeperId}"] date "${d}" is outside leg bounds [${week.startDate}, ${week.endDate}]`,
            );
          }
          if (playedLogKeys.has(`${sleeperId}|${d}`)) {
            errors.push(
              `${where}: remainingGames["${sleeperId}"] date "${d}" is already played in game-logs.json`,
            );
          }
        });

        // Active (non-reserve) teammates on the same NBA team must share the same remaining team schedule
        if (player && !reserveSet.has(sleeperId) && dates.every((d) => isValidDateString(d))) {
          const datesKey = dates.join(",");
          const existingTeam = teamRemainingSchedule.get(player.team);
          if (existingTeam && existingTeam.datesKey !== datesKey) {
            errors.push(
              `${where}: active teammate remainingGames conflict for ${player.team}: "${sleeperId}" has [${datesKey}] vs "${existingTeam.sleeperId}" [${existingTeam.datesKey}]`,
            );
          } else if (!existingTeam) {
            teamRemainingSchedule.set(player.team, { sleeperId, datesKey });
          }
        }
      }
    }
  });

  return errors;
}

export function validateLocks(
  locksFile: LocksFile,
  weeksFile: WeeksFile,
  players: PlayersFile,
  logs: GameLog[],
): string[] {
  const errors: string[] = [];
  if (locksFile.leagueId !== LEAGUE_ID) {
    errors.push(`locks.leagueId "${locksFile.leagueId}" must be ${LEAGUE_ID}`);
  }
  if (!Array.isArray(locksFile.locks)) {
    errors.push("locks.locks must be an array");
    return errors;
  }

  const validPlayers = Array.isArray(players.players)
    ? players.players.filter((p): p is NonNullable<typeof p> => typeof p === "object" && p !== null)
    : [];
  const playerMap = new Map(validPlayers.map((p) => [p.sleeperId, p]));

  const validWeeks = Array.isArray(weeksFile.weeks)
    ? weeksFile.weeks.filter((w): w is NonNullable<typeof w> => typeof w === "object" && w !== null)
    : [];
  const weekMap = new Map(validWeeks.map((w) => [w.leg, w]));

  const logMap = new Map<string, GameLog>();
  for (const l of logs) {
    if (typeof l === "object" && l !== null) {
      logMap.set(`${l.sleeperId}|${l.date}`, l);
    }
  }

  const seenPlayerLeg = new Set<string>();

  locksFile.locks.forEach((lock, i) => {
    if (typeof lock !== "object" || lock === null) {
      errors.push(`locks[${i}]: entry must be a non-null object`);
      return;
    }
    const where = `locks[${i}] (${lock.sleeperId ?? "?"} leg ${lock.leg ?? "?"} ${lock.gameDate ?? "?"})`;

    if (typeof lock.sleeperId !== "string" || !playerMap.has(lock.sleeperId)) {
      errors.push(`${where}: sleeperId "${lock.sleeperId}" is not in players.json`);
    }

    const playerLegKey = `${lock.sleeperId}|${lock.leg}`;
    if (seenPlayerLeg.has(playerLegKey)) {
      errors.push(`${where}: duplicate lock for (sleeperId "${lock.sleeperId}", leg ${lock.leg})`);
    } else {
      seenPlayerLeg.add(playerLegKey);
    }

    const week = weekMap.get(lock.leg);
    if (!week) {
      errors.push(`${where}: leg ${lock.leg} does not exist in weeks.json`);
    }

    const validGameDate = isValidDateString(lock.gameDate);
    if (!validGameDate) {
      errors.push(`${where}: gameDate "${lock.gameDate}" must be a valid YYYY-MM-DD date`);
    } else if (week && isValidDateString(week.startDate) && isValidDateString(week.endDate)) {
      if (lock.gameDate < week.startDate || lock.gameDate > week.endDate) {
        errors.push(
          `${where}: gameDate "${lock.gameDate}" is outside leg ${lock.leg} bounds [${week.startDate}, ${week.endDate}]`,
        );
      }
    }

    const log = logMap.get(`${lock.sleeperId}|${lock.gameDate}`);
    if (!log) {
      errors.push(
        `${where}: no matching GameLog in game-logs.json for (${lock.sleeperId}, ${lock.gameDate})`,
      );
    } else if (typeof lock.lockedTotal !== "number" || !Number.isFinite(lock.lockedTotal)) {
      errors.push(`${where}: lockedTotal must be a finite number`);
    } else if (STAT_FIELDS.every((f) => isNonNegativeInteger(log[f]))) {
      const computed = fantasyPoints(log).total;
      if (computed !== lock.lockedTotal) {
        errors.push(
          `${where}: lockedTotal ${lock.lockedTotal} !== fantasyPoints(log).total ${computed}`,
        );
      }
    }

    if (typeof lock.lockedAt !== "string") {
      errors.push(`${where}: lockedAt must be a string (ISO 8601 timestamp or "")`);
    }
    if (!["user", "sleeper-verified"].includes(lock.source)) {
      errors.push(`${where}: source must be "user" | "sleeper-verified", got ${JSON.stringify(lock.source)}`);
    }
  });

  return errors;
}

export function validatePhase3(
  players: PlayersFile,
  logs: GameLog[],
  weeks: WeeksFile,
  locks: LocksFile,
): string[] {
  return [
    ...validateWeeks(weeks, players, logs),
    ...validateLocks(locks, weeks, players, logs),
  ];
}

export function validateAll(
  players: PlayersFile,
  logs: GameLog[],
  weeks?: WeeksFile,
  locks?: LocksFile,
): string[] {
  const errors = [...validatePlayers(players), ...validateGameLogs(logs, players)];
  if (weeks !== undefined) {
    errors.push(...validateWeeks(weeks, players, logs));
  }
  if (locks !== undefined && weeks !== undefined) {
    errors.push(...validateLocks(locks, weeks, players, logs));
  }
  return errors;
}
