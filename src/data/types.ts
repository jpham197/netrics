// Netrics data types — spec v1.0 §4 (FROZEN).
// NOTE: GameLog.expectedTotal is validation-only. Analytics/UI must never read it.

export const LEAGUE_ID = "1358656481750171649";

export type RosterStatus = "starter" | "bench" | "reserve";

export interface Player {
  /** Sleeper player ID — canonical primary key, never the player name. */
  sleeperId: string;
  name: string;
  /** Verified Sleeper/NBA team abbreviation. */
  team: string;
  positions: string[];
  /** Snapshot status as of PlayersFile.asOf. */
  rosterStatus: RosterStatus;
}

export interface PlayersFile {
  /** YYYY-MM-DD snapshot date. */
  asOf: string;
  leagueId: string;
  players: Player[];
}

export interface GameLog {
  /** Foreign key -> Player.sleeperId. */
  sleeperId: string;
  /** YYYY-MM-DD (America/New_York game date). */
  date: string;
  /** e.g. "LAL" or "@NOP". */
  opponent: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  /** Defaults to 0. */
  tf?: number;
  /** Defaults to 0. */
  ff?: number;
  /** Required provenance, e.g. "sleeper-gamelog+nba-box-2026-11-06". */
  source: string;
  /**
   * Optional validation-only cross-check. NEVER read by UI/analytics.
   * `npm run validate` asserts fantasyPoints(log).total === expectedTotal.
   */
  expectedTotal?: number;
}
