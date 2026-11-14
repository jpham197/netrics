// Deterministic, schema-valid E2E fixtures & mock Sleeper/ESPN API payloads.
// Never mutates repo `data/*.json`. All GameLogs include full box scores,
// non-empty `source`, and unique `(sleeperId, date)`.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LEAGUE_ID,
  type EspnPlayerMapFile,
  type GameLog,
  type LocksFile,
  type PlayersFile,
  type WeeksFile,
} from "../../../src/data/types.js";
import { fantasyPoints } from "../../../src/scoring/index.js";

export const E2E_AS_OF = "2026-11-05";

export function createFixturePlayersFile(): PlayersFile {
  return {
    asOf: E2E_AS_OF,
    leagueId: LEAGUE_ID,
    players: [
      { sleeperId: "s-pg-1", name: "Jalen Brunson", team: "NYK", positions: ["PG"], rosterStatus: "starter" },
      { sleeperId: "s-sg-1", name: "Devin Booker", team: "PHX", positions: ["SG", "PG"], rosterStatus: "starter" },
      { sleeperId: "s-g-1", name: "Tyrese Haliburton", team: "IND", positions: ["PG", "SG"], rosterStatus: "starter" },
      { sleeperId: "s-sf-1", name: "Jayson Tatum", team: "BOS", positions: ["SF", "PF"], rosterStatus: "starter" },
      { sleeperId: "s-pf-1", name: "Giannis Antetokounmpo", team: "MIL", positions: ["PF", "C"], rosterStatus: "starter" },
      { sleeperId: "s-f-1", name: "Franz Wagner", team: "ORL", positions: ["SF", "PF"], rosterStatus: "starter" },
      { sleeperId: "s-c-1", name: "Nikola Jokic", team: "DEN", positions: ["C"], rosterStatus: "starter" },
      { sleeperId: "s-u1-1", name: "Shai Gilgeous-Alexander", team: "OKC", positions: ["PG", "SG"], rosterStatus: "starter" },
      { sleeperId: "s-u2-1", name: "Anthony Davis", team: "LAL", positions: ["PF", "C"], rosterStatus: "starter" },
      { sleeperId: "s-b1-1", name: "Darius Garland", team: "CLE", positions: ["PG", "SG"], rosterStatus: "bench" },
      { sleeperId: "s-b2-1", name: "Bam Adebayo", team: "MIA", positions: ["C"], rosterStatus: "bench" },
      { sleeperId: "s-r1-1", name: "Paolo Banchero", team: "ORL", positions: ["PF", "SF"], rosterStatus: "reserve" },
    ],
  };
}

export function createFixtureEspnMap(): EspnPlayerMapFile {
  return {
    leagueId: LEAGUE_ID,
    players: [
      { sleeperId: "s-pg-1", espnAthleteId: "3934672", name: "Jalen Brunson", espnTeam: "NYK" },
      { sleeperId: "s-sg-1", espnAthleteId: "3136193", name: "Devin Booker", espnTeam: "PHX" },
      { sleeperId: "s-g-1", espnAthleteId: "4396993", name: "Tyrese Haliburton", espnTeam: "IND" },
      { sleeperId: "s-sf-1", espnAthleteId: "4065648", name: "Jayson Tatum", espnTeam: "BOS" },
      { sleeperId: "s-pf-1", espnAthleteId: "3032977", name: "Giannis Antetokounmpo", espnTeam: "MIL" },
      { sleeperId: "s-f-1", espnAthleteId: "4566434", name: "Franz Wagner", espnTeam: "ORL" },
      { sleeperId: "s-c-1", espnAthleteId: "3112335", name: "Nikola Jokic", espnTeam: "DEN" },
      { sleeperId: "s-u1-1", espnAthleteId: "4278073", name: "Shai Gilgeous-Alexander", espnTeam: "OKC" },
      { sleeperId: "s-u2-1", espnAthleteId: "6583", name: "Anthony Davis", espnTeam: "LAL" },
      { sleeperId: "s-b1-1", espnAthleteId: "4396907", name: "Darius Garland", espnTeam: "CLE" },
      { sleeperId: "s-b2-1", espnAthleteId: "4066261", name: "Bam Adebayo", espnTeam: "MIA" },
      { sleeperId: "s-r1-1", espnAthleteId: "4432573", name: "Paolo Banchero", espnTeam: "ORL" },
    ],
  };
}

export function createFixtureGameLogs(): GameLog[] {
  return [
    // Jalen Brunson (NYK) - 4 games
    { sleeperId: "s-pg-1", date: "2026-10-25", opponent: "DET", pts: 36, reb: 4, ast: 8, stl: 1, blk: 0, tov: 2, source: "e2e-fixture-2026-10-25" },
    { sleeperId: "s-pg-1", date: "2026-10-28", opponent: "@ATL", pts: 24, reb: 3, ast: 6, stl: 0, blk: 0, tov: 3, source: "e2e-fixture-2026-10-28" },
    { sleeperId: "s-pg-1", date: "2026-11-02", opponent: "CHI", pts: 31, reb: 5, ast: 9, stl: 2, blk: 0, tov: 1, source: "e2e-fixture-2026-11-02" },
    { sleeperId: "s-pg-1", date: "2026-11-04", opponent: "@WAS", pts: 28, reb: 2, ast: 7, stl: 1, blk: 0, tov: 2, source: "e2e-fixture-2026-11-04" },

    // Devin Booker (PHX) - 3 games
    { sleeperId: "s-sg-1", date: "2026-10-26", opponent: "SAC", pts: 33, reb: 4, ast: 7, stl: 1, blk: 1, tov: 2, source: "e2e-fixture-2026-10-26" },
    { sleeperId: "s-sg-1", date: "2026-11-03", opponent: "@UTA", pts: 29, reb: 5, ast: 6, stl: 2, blk: 0, tov: 3, source: "e2e-fixture-2026-11-03" },
    { sleeperId: "s-sg-1", date: "2026-11-05", opponent: "NOP", pts: 22, reb: 3, ast: 5, stl: 0, blk: 0, tov: 2, source: "e2e-fixture-2026-11-05" },

    // Tyrese Haliburton (IND) - 2 games
    { sleeperId: "s-g-1", date: "2026-11-02", opponent: "@TOR", pts: 19, reb: 4, ast: 13, stl: 2, blk: 1, tov: 2, source: "e2e-fixture-2026-11-02" },
    { sleeperId: "s-g-1", date: "2026-11-04", opponent: "CHA", pts: 25, reb: 3, ast: 11, stl: 1, blk: 0, tov: 1, source: "e2e-fixture-2026-11-04" },

    // Jayson Tatum (BOS) - 2 games
    { sleeperId: "s-sf-1", date: "2026-11-02", opponent: "BKN", pts: 34, reb: 10, ast: 5, stl: 1, blk: 1, tov: 2, source: "e2e-fixture-2026-11-02" },
    { sleeperId: "s-sf-1", date: "2026-11-05", opponent: "@GSW", pts: 30, reb: 8, ast: 6, stl: 2, blk: 0, tov: 3, source: "e2e-fixture-2026-11-05" },

    // Giannis Antetokounmpo (MIL) - 2 games
    { sleeperId: "s-pf-1", date: "2026-11-03", opponent: "MEM", pts: 38, reb: 13, ast: 7, stl: 1, blk: 2, tov: 3, source: "e2e-fixture-2026-11-03" },
    { sleeperId: "s-pf-1", date: "2026-11-05", opponent: "@SAS", pts: 29, reb: 11, ast: 5, stl: 0, blk: 1, tov: 4, source: "e2e-fixture-2026-11-05" },

    // Franz Wagner (ORL) - 1 game (Note: same team as reserve Paolo Banchero)
    { sleeperId: "s-f-1", date: "2026-11-04", opponent: "HOU", pts: 26, reb: 6, ast: 5, stl: 2, blk: 1, tov: 2, source: "e2e-fixture-2026-11-04" },

    // Nikola Jokic (DEN) - 4 games (huge spike + triple double)
    { sleeperId: "s-c-1", date: "2026-10-27", opponent: "@MIN", pts: 32, reb: 14, ast: 11, stl: 2, blk: 1, tov: 3, source: "e2e-fixture-2026-10-27" },
    { sleeperId: "s-c-1", date: "2026-10-30", opponent: "DAL", pts: 27, reb: 12, ast: 10, stl: 1, blk: 0, tov: 2, source: "e2e-fixture-2026-10-30" },
    { sleeperId: "s-c-1", date: "2026-11-02", opponent: "LAC", pts: 41, reb: 15, ast: 12, stl: 3, blk: 1, tov: 2, source: "e2e-fixture-2026-11-02" },
    { sleeperId: "s-c-1", date: "2026-11-04", opponent: "@POR", pts: 22, reb: 9, ast: 8, stl: 1, blk: 0, tov: 3, source: "e2e-fixture-2026-11-04" },

    // Shai Gilgeous-Alexander (OKC) - 2 games
    { sleeperId: "s-u1-1", date: "2026-11-02", opponent: "@SAC", pts: 35, reb: 5, ast: 6, stl: 3, blk: 1, tov: 1, source: "e2e-fixture-2026-11-02" },
    { sleeperId: "s-u1-1", date: "2026-11-05", opponent: "POR", pts: 31, reb: 4, ast: 7, stl: 2, blk: 2, tov: 2, source: "e2e-fixture-2026-11-05" },

    // Anthony Davis (LAL) - 2 games
    { sleeperId: "s-u2-1", date: "2026-11-03", opponent: "PHI", pts: 33, reb: 14, ast: 3, stl: 1, blk: 3, tov: 2, source: "e2e-fixture-2026-11-03" },
    { sleeperId: "s-u2-1", date: "2026-11-05", opponent: "@MEM", pts: 28, reb: 11, ast: 2, stl: 2, blk: 2, tov: 1, source: "e2e-fixture-2026-11-05" },

    // Bench: Darius Garland (CLE) - 2 games
    { sleeperId: "s-b1-1", date: "2026-11-02", opponent: "MIL", pts: 27, reb: 3, ast: 10, stl: 1, blk: 0, tov: 2, source: "e2e-fixture-2026-11-02" },
    { sleeperId: "s-b1-1", date: "2026-11-04", opponent: "@NOP", pts: 21, reb: 2, ast: 8, stl: 1, blk: 0, tov: 2, source: "e2e-fixture-2026-11-04" },

    // Bench: Bam Adebayo (MIA) - 1 game
    { sleeperId: "s-b2-1", date: "2026-11-03", opponent: "DET", pts: 20, reb: 11, ast: 4, stl: 1, blk: 2, tov: 1, source: "e2e-fixture-2026-11-03" },

    // Reserve: Paolo Banchero (ORL) - 1 historical game (0 games in leg 3)
    { sleeperId: "s-r1-1", date: "2026-10-25", opponent: "BKN", pts: 28, reb: 9, ast: 6, stl: 1, blk: 0, tov: 3, source: "e2e-fixture-2026-10-25" },
  ];
}

export function createFixtureWeeksFile(): WeeksFile {
  return {
    leagueId: LEAGUE_ID,
    weeks: [
      {
        leg: 3,
        startDate: "2026-11-02",
        endDate: "2026-11-08",
        matchupId: 1,
        opponentRosterId: 2,
        opponentName: "HoopsRival",
        opponentPoints: 342.5,
        opponentAsOf: "2026-11-05T23:00:00Z",
        opponentRemainingGames: 8,
        opponentPlayers: [
          { sleeperId: "opp-1", name: "Luka Doncic", position: "PG", team: "DAL", points: 62.5 },
        ],
        starters: [
          "s-pg-1",
          "s-sg-1",
          "s-g-1",
          "s-sf-1",
          "s-pf-1",
          "s-f-1",
          "s-c-1",
          "s-u1-1",
          "s-u2-1",
        ],
        bench: ["s-b1-1", "s-b2-1"],
        reserve: ["s-r1-1"],
        remainingGames: {
          "s-pg-1": ["2026-11-06", "2026-11-08"],
          "s-sg-1": ["2026-11-07"],
          "s-g-1": ["2026-11-06", "2026-11-08"],
          "s-sf-1": ["2026-11-07"],
          "s-pf-1": ["2026-11-07"],
          "s-f-1": ["2026-11-06", "2026-11-08"],
          "s-c-1": ["2026-11-06", "2026-11-08"],
          "s-u1-1": ["2026-11-07"],
          "s-u2-1": ["2026-11-08"],
          "s-b1-1": ["2026-11-06", "2026-11-08"],
          "s-b2-1": ["2026-11-06", "2026-11-08"],
          "s-r1-1": [],
        },
      },
    ],
  };
}

export function createFixtureLocksFile(logs: GameLog[] = createFixtureGameLogs()): LocksFile {
  const jokicLog = logs.find((l) => l.sleeperId === "s-c-1" && l.date === "2026-11-02");
  const brunsonLog = logs.find((l) => l.sleeperId === "s-pg-1" && l.date === "2026-11-02");
  if (!jokicLog || !brunsonLog) {
    throw new Error("Fixture lock logs missing");
  }
  return {
    leagueId: LEAGUE_ID,
    locks: [
      {
        sleeperId: "s-c-1",
        leg: 3,
        gameDate: "2026-11-02",
        lockedTotal: fantasyPoints(jokicLog).total,
        lockedAt: "2026-11-03T05:00:00Z",
        source: "user",
      },
      {
        sleeperId: "s-pg-1",
        leg: 3,
        gameDate: "2026-11-02",
        lockedTotal: fantasyPoints(brunsonLog).total,
        lockedAt: "2026-11-03T04:30:00Z",
        source: "sleeper-verified",
      },
    ],
  };
}

export interface TempDataWorkspace {
  dir: string;
  playersPath: string;
  logsPath: string;
  weeksPath: string;
  locksPath: string;
  espnMapPath: string;
  readPlayers: () => PlayersFile;
  readLogs: () => GameLog[];
  readWeeks: () => WeeksFile;
  readLocks: () => LocksFile;
  readEspnMap: () => EspnPlayerMapFile;
  cleanup: () => void;
}

export function createTempDataWorkspace(): TempDataWorkspace {
  const dir = mkdtempSync(join(tmpdir(), "netrics-e2e-"));
  const playersPath = join(dir, "players.json");
  const logsPath = join(dir, "game-logs.json");
  const weeksPath = join(dir, "weeks.json");
  const locksPath = join(dir, "locks.json");
  const espnMapPath = join(dir, "espn-player-map.json");

  const players = createFixturePlayersFile();
  const logs = createFixtureGameLogs();
  const weeks = createFixtureWeeksFile();
  const locks = createFixtureLocksFile(logs);
  const espnMap = createFixtureEspnMap();

  writeFileSync(playersPath, `${JSON.stringify(players, null, 2)}\n`, "utf-8");
  writeFileSync(logsPath, `${JSON.stringify(logs, null, 2)}\n`, "utf-8");
  writeFileSync(weeksPath, `${JSON.stringify(weeks, null, 2)}\n`, "utf-8");
  writeFileSync(locksPath, `${JSON.stringify(locks, null, 2)}\n`, "utf-8");
  writeFileSync(espnMapPath, `${JSON.stringify(espnMap, null, 2)}\n`, "utf-8");

  return {
    dir,
    playersPath,
    logsPath,
    weeksPath,
    locksPath,
    espnMapPath,
    readPlayers: () => JSON.parse(readFileSync(playersPath, "utf-8")) as PlayersFile,
    readLogs: () => JSON.parse(readFileSync(logsPath, "utf-8")) as GameLog[],
    readWeeks: () => JSON.parse(readFileSync(weeksPath, "utf-8")) as WeeksFile,
    readLocks: () => JSON.parse(readFileSync(locksPath, "utf-8")) as LocksFile,
    readEspnMap: () => JSON.parse(readFileSync(espnMapPath, "utf-8")) as EspnPlayerMapFile,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function makeEspnScoreboardPayload(
  dateYyyyMmDd: string,
  games: Array<{ eventId: string; homeTeam: string; awayTeam: string; isFinal?: boolean }>,
) {
  return {
    day: { date: dateYyyyMmDd },
    events: games.map((g) => ({
      id: g.eventId,
      date: `${dateYyyyMmDd}T23:30Z`,
      status: {
        type: g.isFinal === false
          ? { completed: false, description: "Scheduled", name: "STATUS_SCHEDULED" }
          : { completed: true, description: "Final", name: "STATUS_FINAL" },
      },
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { abbreviation: g.homeTeam } },
            { homeAway: "away", team: { abbreviation: g.awayTeam } },
          ],
        },
      ],
    })),
  };
}

export function makeEspnSummaryPayload(
  teamAthletes: Array<{
    teamAbbr: string;
    athletes: Array<{
      espnAthleteId: string;
      displayName: string;
      min: string;
      pts: number;
      reb: number;
      ast: number;
      stl: number;
      blk: number;
      tov: number;
    }>;
  }>,
) {
  return {
    boxscore: {
      players: teamAthletes.map((t) => ({
        team: { abbreviation: t.teamAbbr },
        statistics: [
          {
            labels: ["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"],
            athletes: t.athletes.map((a) => ({
              athlete: { id: a.espnAthleteId, displayName: a.displayName },
              stats: [
                a.min,
                "8-15",
                "2-5",
                "4-4",
                "1",
                String(Math.max(0, a.reb - 1)),
                String(a.reb),
                String(a.ast),
                String(a.stl),
                String(a.blk),
                String(a.tov),
                "2",
                "+5",
                String(a.pts),
              ],
            })),
          },
        ],
      })),
    },
  };
}

export function createUiFetchStub(overrides?: {
  players?: PlayersFile;
  logs?: GameLog[];
  weeks?: WeeksFile;
  locks?: LocksFile;
}) {
  const players = overrides?.players ?? createFixturePlayersFile();
  const logs = overrides?.logs ?? createFixtureGameLogs();
  const weeks = overrides?.weeks ?? createFixtureWeeksFile();
  const locks = overrides?.locks ?? createFixtureLocksFile(logs);

  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("data/players.json")) {
      return new Response(JSON.stringify(players), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("data/game-logs.json")) {
      return new Response(JSON.stringify(logs), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("data/weeks.json")) {
      return new Response(JSON.stringify(weeks), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("data/locks.json")) {
      return new Response(JSON.stringify(locks), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("api.sleeper.app")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("Not Found", { status: 404 });
  };
}
