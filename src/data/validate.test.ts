// Validator tests — spec v1.0 §4 and Phase 3 v1.0 §3.1 invariants.

import { describe, expect, it } from "vitest";
import { loadAll, loadGameLogs, loadLocks, loadPlayers, loadWeeks } from "./load.js";
import { validateAll, validateLocks, validateWeeks } from "./validate.js";
import type { GameLog, LocksFile, PlayersFile, WeekRecord, WeeksFile } from "./types.js";

const players: PlayersFile = {
  asOf: "2026-11-07",
  leagueId: "1358656481750171649",
  players: [
    { sleeperId: "2181", name: "Deni Avdija", team: "POR", positions: ["PF"], rosterStatus: "starter" },
    { sleeperId: "2441", name: "Walker Kessler", team: "LAL", positions: ["C"], rosterStatus: "starter" },
  ],
};

function log(over: Partial<GameLog> & { sleeperId: string; date: string }): GameLog {
  return { opponent: "@LAL", pts: 22, reb: 9, ast: 11, stl: 2, blk: 0, tov: 8, source: "test", ...over };
}

describe("validateAll — valid data passes", () => {
  it("accepts a correct Avdija line with matching expectedTotal", () => {
    expect(validateAll(players, [log({ sleeperId: "2181", date: "2026-11-06", expectedTotal: 49.75 })])).toEqual([]);
  });

  it("accepts a log with no expectedTotal (cross-check is optional)", () => {
    expect(validateAll(players, [log({ sleeperId: "2181", date: "2026-11-06" })])).toEqual([]);
  });

  it("validates the real committed data/players.json, data/game-logs.json, data/weeks.json, and data/locks.json seed files with zero errors", () => {
    const { players: realPlayers, logs: realLogs, weeks: realWeeks, locks: realLocks } = loadAll();
    expect(validateAll(realPlayers, realLogs, realWeeks, realLocks)).toEqual([]);
    expect(realPlayers.players.length).toBe(15);
    expect(realLogs.length).toBeGreaterThanOrEqual(118);
    expect(realWeeks.weeks.length).toBe(1);
    expect(realWeeks.weeks[0]?.matchupId).toBe(4);
    expect(realLocks.locks.length).toBe(5);
  });
});

describe("validateAll — §4 invariants fail", () => {
  it("rejects duplicate (sleeperId, date)", () => {
    const errors = validateAll(players, [
      log({ sleeperId: "2181", date: "2026-11-06" }),
      log({ sleeperId: "2181", date: "2026-11-06", pts: 10 }),
    ]);
    expect(errors.some((e) => e.includes("duplicate (sleeperId, date)"))).toBe(true);
  });

  it("rejects a sleeperId not in players.json", () => {
    const errors = validateAll(players, [log({ sleeperId: "9999", date: "2026-11-06" })]);
    expect(errors.some((e) => e.includes("not in players.json"))).toBe(true);
  });

  it("rejects a missing / empty source", () => {
    const errors = validateAll(players, [log({ sleeperId: "2181", date: "2026-11-06", source: "" })]);
    expect(errors.some((e) => e.includes("source must be a non-empty string"))).toBe(true);
  });

  it("rejects a non-integer or negative stat", () => {
    const errors = validateAll(players, [
      log({ sleeperId: "2181", date: "2026-11-06", pts: 22.5 }),
      log({ sleeperId: "2441", date: "2026-11-04", opponent: "@SAC", tov: -1 }),
    ]);
    expect(errors.length).toBe(2);
  });

  it("rejects expectedTotal that disagrees with the engine", () => {
    const errors = validateAll(players, [log({ sleeperId: "2181", date: "2026-11-06", expectedTotal: 49.5 })]);
    expect(errors.some((e) => e.includes("fantasyPoints total 49.75 !== expectedTotal 49.5"))).toBe(true);
  });

  it("rejects a bad asOf date and a wrong leagueId", () => {
    const badPlayers: PlayersFile = { asOf: "Nov 7", leagueId: "0", players: players.players };
    const errors = validateAll(badPlayers, []);
    expect(errors.some((e) => e.includes("asOf"))).toBe(true);
    expect(errors.some((e) => e.includes("leagueId"))).toBe(true);
  });

  it("rejects duplicate player IDs", () => {
    const dup: PlayersFile = { ...players, players: [players.players[0] as never, players.players[0] as never] };
    expect(validateAll(dup, []).some((e) => e.includes("duplicate sleeperId"))).toBe(true);
  });

  it("rejects null entries, invalid calendar dates (2026-02-31), and NaN expectedTotal without crashing", () => {
    const badPlayers: PlayersFile = { ...players, players: [null as never, ...players.players] };
    const errors = validateAll(badPlayers, [
      null as never,
      log({ sleeperId: "2181", date: "2026-02-31" }),
      log({ sleeperId: "2181", date: "2026-11-06", expectedTotal: Number.NaN }),
    ]);
    expect(errors.some((e) => e.includes("players[0]: entry must be a non-null object"))).toBe(true);
    expect(errors.some((e) => e.includes("game-logs[0]: entry must be a non-null object"))).toBe(true);
    expect(errors.some((e) => e.includes("valid YYYY-MM-DD calendar date"))).toBe(true);
    expect(errors.some((e) => e.includes("expectedTotal must be a finite number"))).toBe(true);
  });

  it("rejects self-opponent and cross-player home/away symmetry mismatches on the same date", () => {
    const errors = validateAll(players, [
      log({ sleeperId: "2181", date: "2026-11-01", opponent: "POR" }),
      log({ sleeperId: "2181", date: "2026-11-06", opponent: "LAL" }),
      log({ sleeperId: "2441", date: "2026-11-06", opponent: "POR" }),
    ]);
    expect(errors.some((e) => e.includes("cannot be player's own team"))).toBe(true);
    expect(errors.some((e) => e.includes("cross-player home/away mismatch on 2026-11-06"))).toBe(true);
  });
});

describe("validatePhase3 — Phase 3 v1.0 §3.1 invariants", () => {
  const realPlayers = loadPlayers("data/players.json");
  const realLogs = loadGameLogs("data/game-logs.json");
  const realWeeks = loadWeeks("data/weeks.json");
  const realLocks = loadLocks("data/locks.json");
  const baseWeek = realWeeks.weeks[0] as WeekRecord;

  it("rejects duplicate lock per (sleeperId, leg)", () => {
    const badLocks: LocksFile = {
      ...realLocks,
      locks: [
        ...realLocks.locks,
        {
          sleeperId: "2267",
          leg: 3,
          gameDate: "2026-11-04",
          lockedTotal: 58.25,
          lockedAt: "",
          source: "user",
        },
      ],
    };
    const errors = validateLocks(badLocks, realWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes('duplicate lock for (sleeperId "2267", leg 3)'))).toBe(true);
  });

  it("rejects a lock pointing to a missing game log", () => {
    const badLocks: LocksFile = {
      ...realLocks,
      locks: [
        {
          sleeperId: "2441",
          leg: 3,
          gameDate: "2026-11-05",
          lockedTotal: 40.0,
          lockedAt: "",
          source: "user",
        },
      ],
    };
    const errors = validateLocks(badLocks, realWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes("no matching GameLog in game-logs.json for (2441, 2026-11-05)"))).toBe(true);
  });

  it("rejects a lock whose lockedTotal mismatches fantasyPoints(log).total", () => {
    const badLocks: LocksFile = {
      ...realLocks,
      locks: [
        {
          sleeperId: "1752",
          leg: 3,
          gameDate: "2026-11-04",
          lockedTotal: 39.5, // actual Nov 4 @NOP is 47.50
          lockedAt: "",
          source: "user",
        },
      ],
    };
    const errors = validateLocks(badLocks, realWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes("lockedTotal 39.5 !== fantasyPoints(log).total 47.5"))).toBe(true);
  });

  it("rejects a lock whose gameDate is outside the leg [startDate, endDate] or leg is missing", () => {
    const badLocks: LocksFile = {
      ...realLocks,
      locks: [
        {
          sleeperId: "2441",
          leg: 3,
          gameDate: "2026-10-30", // Leg 2 game log in Leg 3 lock
          lockedTotal: 45.25,
          lockedAt: "",
          source: "user",
        },
        {
          sleeperId: "2267",
          leg: 99,
          gameDate: "2026-11-02",
          lockedTotal: 61.75,
          lockedAt: "",
          source: "user",
        },
      ],
    };
    const errors = validateLocks(badLocks, realWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes('outside leg 3 bounds [2026-11-02, 2026-11-08]'))).toBe(true);
    expect(errors.some((e) => e.includes("leg 99 does not exist in weeks.json"))).toBe(true);
  });

  it("rejects wrong starter count, duplicate player in week, or unknown sleeperId", () => {
    const badWeeks: WeeksFile = {
      ...realWeeks,
      weeks: [
        {
          ...baseWeek,
          starters: baseWeek.starters.slice(0, 8),
          bench: [...baseWeek.bench, "2267", "9999"],
        },
      ],
    };
    const errors = validateWeeks(badWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes("starters must have exactly 9 entries"))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate player "2267"'))).toBe(true);
    expect(errors.some((e) => e.includes('sleeperId "9999" is not in players.json'))).toBe(true);
  });

  it("rejects a starter placed in a slot they are ineligible for", () => {
    // Slot 1 is SG; putting Walker Kessler (2441, C) in slot 1 is illegal
    const swappedStarters = [...baseWeek.starters];
    swappedStarters[1] = "2441";
    swappedStarters[7] = "4737";
    const badWeeks: WeeksFile = {
      ...realWeeks,
      weeks: [{ ...baseWeek, starters: swappedStarters }],
    };
    const errors = validateWeeks(badWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes("ineligible for slot SG"))).toBe(true);
  });

  it("rejects remainingGames date outside leg bounds or already played in game-logs.json", () => {
    const badWeeks: WeeksFile = {
      ...realWeeks,
      weeks: [
        {
          ...baseWeek,
          remainingGames: {
            ...baseWeek.remainingGames,
            "2441": ["2026-11-06", "2026-11-09"], // Nov 6 already played; Nov 9 outside leg
          },
        },
      ],
    };
    const errors = validateWeeks(badWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes('date "2026-11-06" is already played in game-logs.json'))).toBe(true);
    expect(errors.some((e) => e.includes('date "2026-11-09" is outside leg bounds'))).toBe(true);
  });

  it("rejects active-teammate remainingGames conflicts, unsorted dates, and missing remainingGames keys", () => {
    const { "2267": _omitted, ...incompleteRemaining } = baseWeek.remainingGames;
    const badWeeks: WeeksFile = {
      ...realWeeks,
      weeks: [
        {
          ...baseWeek,
          remainingGames: {
            ...incompleteRemaining,
            // 4750 (Fears, NOP) vs 2131 (Saddiq Bey, NOP) teammate conflict
            "4750": ["2026-11-07", "2026-11-08"],
            "2131": ["2026-11-08"],
            // Unsorted dates on 4742 (Traore, BKN)
            "4742": ["2026-11-08", "2026-11-07"],
          },
        },
      ],
    };
    const errors = validateWeeks(badWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes('rostered player "2267" is missing an entry in remainingGames'))).toBe(true);
    expect(errors.some((e) => e.includes("active teammate remainingGames conflict for NOP"))).toBe(true);
    expect(errors.some((e) => e.includes('remainingGames["4742"] dates must be in ascending order'))).toBe(true);
  });

  it("rejects out-of-bounds matchupId (> 6) or self opponentRosterId (1)", () => {
    const badWeeks: WeeksFile = {
      ...realWeeks,
      weeks: [
        {
          ...baseWeek,
          matchupId: 7,
          opponentRosterId: 1,
        },
      ],
    };
    const errors = validateWeeks(badWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes("matchupId must be an integer in 1..6"))).toBe(true);
    expect(errors.some((e) => e.includes("opponentRosterId must be an integer in 2..12"))).toBe(true);
  });

  it("accepts valid opponentPlayers[].sleeperId and rejects empty or duplicate sleeperId", () => {
    const validWeeks: WeeksFile = {
      ...realWeeks,
      weeks: [
        {
          ...baseWeek,
          opponentPlayers: [
            { sleeperId: "3001", name: "Opp Starter A", position: "PG", team: "BOS", points: 44.5 },
            { sleeperId: "3002", name: "Opp Starter B", position: "C", team: "DEN", points: 51.25 },
            { name: "Opp Starter C (no id)", points: 30.0 },
          ],
        },
      ],
    };
    expect(validateWeeks(validWeeks, realPlayers, realLogs)).toEqual([]);

    const badWeeks: WeeksFile = {
      ...realWeeks,
      weeks: [
        {
          ...baseWeek,
          opponentPlayers: [
            { sleeperId: "", name: "Empty ID", points: 20.0 },
            { sleeperId: "3001", name: "First", points: 35.0 },
            { sleeperId: "3001", name: "Duplicate", points: 28.5 },
          ],
        },
      ],
    };
    const errors = validateWeeks(badWeeks, realPlayers, realLogs);
    expect(errors.some((e) => e.includes("opponentPlayers[0].sleeperId must be a non-empty string"))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate opponentPlayers[2].sleeperId "3001"'))).toBe(true);
  });
});

