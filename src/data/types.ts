// Netrics data types — spec v1.0 §4 & Phase 3 v1.0 §3 (FROZEN).
// NOTE: GameLog.expectedTotal is validation-only. Analytics/UI must never read it.

export const LEAGUE_ID = "1358656481750171649";

export const STARTER_SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"] as const;
export type StarterSlot = (typeof STARTER_SLOTS)[number];

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

export interface OpponentPlayerScore {
  sleeperId?: string;
  name: string;
  position?: string;
  team?: string;
  points: number;
}

export interface WeekRecord {
  /** Sleeper leg, e.g. 3. */
  leg: number;
  /** YYYY-MM-DD, Monday (leg 1: 2026-10-20). */
  startDate: string;
  /** YYYY-MM-DD, Sunday. */
  endDate: string;
  /** Sleeper matchup_id for the user's matchup that leg. */
  matchupId: number;
  /** Sleeper roster_id of the opponent. */
  opponentRosterId: number;
  /** Sleeper username, e.g. "notNoah224". */
  opponentName: string;
  /** Snapshot of opponent's week total from Sleeper. */
  opponentPoints: number;
  /** ISO date/timestamp of opponent snapshot. */
  opponentAsOf: string;
  /** Optional count of opponent starter games remaining. */
  opponentRemainingGames?: number;
  /** Optional starter breakdown from Sleeper snapshot. */
  opponentPlayers?: OpponentPlayerScore[];
  /** 9 sleeperIds in slot order (PG, SG, G, SF, PF, F, C, UTIL, UTIL). */
  starters: string[];
  /** Bench sleeperIds for that leg (up to 6). */
  bench: string[];
  /** Reserve / IR sleeperIds for that leg (up to 2). */
  reserve: string[];
  /** Remaining unplayed games per player in this leg, by YYYY-MM-DD date. */
  remainingGames: Record<string, string[]>;
}

export interface WeeksFile {
  leagueId: string;
  weeks: WeekRecord[];
}

export type LockSource = "user" | "sleeper-verified";

export interface LockRecord {
  /** Foreign key -> Player.sleeperId. */
  sleeperId: string;
  /** Leg the lock belongs to (must exist in weeks.json). */
  leg: number;
  /** YYYY-MM-DD of the locked game (must exist in game-logs.json). */
  gameDate: string;
  /** Must equal fantasyPoints(that game log).total. */
  lockedTotal: number;
  /** ISO 8601 timestamp when locked, or "" if unknown. */
  lockedAt: string;
  /** "user" or "sleeper-verified". */
  source: LockSource;
  note?: string;
}

export interface LocksFile {
  leagueId: string;
  locks: LockRecord[];
}

export interface EspnPlayerMapEntry {
  /** Foreign key -> Player.sleeperId. */
  sleeperId: string;
  /** Numeric ESPN athlete ID string, e.g. "5174563". */
  espnAthleteId: string;
  /** Display name, for human review. */
  name: string;
  /** Canonical 3-letter NBA team code (or ESPN team code normalized via normalizeEspnTeam). */
  espnTeam: string;
}

export interface EspnPlayerMapFile {
  leagueId: string;
  players: EspnPlayerMapEntry[];
}

