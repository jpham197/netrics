// Validator tests — spec v1.0 §4 invariants.

import { describe, expect, it } from "vitest";
import { validateAll } from "./validate.js";
import type { GameLog, PlayersFile } from "./types.js";

const players: PlayersFile = {
  asOf: "2026-11-07",
  leagueId: "1358656481750171649",
  players: [
    { sleeperId: "2181", name: "Deni Avdija", team: "POR", positions: ["PF"], rosterStatus: "starter" },
    { sleeperId: "2441", name: "Walker Kessler", team: "LAL", positions: ["C"], rosterStatus: "starter" },
  ],
};

function log(over: Partial<GameLog> & { sleeperId: string; date: string }): GameLog {
  return { opponent: "LAL", pts: 22, reb: 9, ast: 11, stl: 2, blk: 0, tov: 8, source: "test", ...over };
}

describe("validateAll — valid data passes", () => {
  it("accepts a correct Avdija line with matching expectedTotal", () => {
    expect(validateAll(players, [log({ sleeperId: "2181", date: "2026-11-06", expectedTotal: 49.75 })])).toEqual([]);
  });

  it("accepts a log with no expectedTotal (cross-check is optional)", () => {
    expect(validateAll(players, [log({ sleeperId: "2181", date: "2026-11-06" })])).toEqual([]);
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
      log({ sleeperId: "2441", date: "2026-11-04", tov: -1 }),
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
});

