// Phase 6 — ESPN Box-Score Game-Log Ingestion & Sleeper Reconciliation Engine
// (`docs/design/NETRICS-DESIGN.md` §9 & `docs/decisions/0005-espn-game-log-ingestion.md`).
//
// Pure parsing, normalization, extraction, reconciliation, and report formatting
// functions, plus injectable fetch orchestration for the CLI.

import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  EspnPlayerMapEntry,
  EspnPlayerMapFile,
  GameLog,
  LocksFile,
  PlayersFile,
  WeekRecord,
  WeeksFile,
} from "../data/types.js";
import { LEAGUE_ID } from "../data/types.js";
import { VALID_NBA_TEAMS, normalizeEspnTeam } from "../data/validate.js";
import { fantasyPoints, round2 } from "../scoring/index.js";

export const ESPN_NBA_BASE_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
export const SLEEPER_BASE_URL = "https://api.sleeper.app/v1";

export { normalizeEspnTeam };

export interface DiscoveredEspnGame {
  eventId: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  statusDescription: string;
  isFinal: boolean;
}

export interface CandidateBoxScore {
  sleeperId: string;
  espnAthleteId: string;
  playerName: string;
  team: string;
  eventId: string;
  date: string;
  minutes: number;
  gameLog: GameLog;
}

export type SkipReason = "already logged" | "not Final" | "DNP";

export interface SkippedGameEntry {
  date: string;
  eventId?: string;
  sleeperId?: string;
  playerName?: string;
  matchup?: string;
  reason: SkipReason;
  detail?: string;
}

export type ReconciliationScope =
  | "UNLOCKED_LATEST_IN_LEG"
  | "LOCKED"
  | "EARLIER_IN_LEG"
  | "NO_WEEK";

export type ReconciliationStatus = "MATCH" | "RECONCILE" | "INFO";

export interface ProposedLogReconciliation {
  gameLog: GameLog;
  playerName: string;
  computedTotal: number;
  sleeperTotal: number | null;
  diff: number | null;
  leg: number | null;
  scope: ReconciliationScope;
  status: ReconciliationStatus;
  flag?: string;
}

export interface VerifyExistingEntry {
  sleeperId: string;
  playerName: string;
  date: string;
  status: "VERIFIED" | "VERIFY_DIFF";
  committedLog: GameLog;
  espnLog: GameLog;
  diffs: string[];
  flag?: string;
}

export interface EspnIngestionReport {
  dates: string[];
  verifyExisting: boolean;
  discoveredGames: DiscoveredEspnGame[];
  proposedLogs: GameLog[];
  reconciliations: ProposedLogReconciliation[];
  verifiedExisting: VerifyExistingEntry[];
  skipped: SkippedGameEntry[];
  reconcileFlags: string[];
  verifyDiffFlags: string[];
  errors: string[];
  hasFailures: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parses an ESPN box-score `MIN` cell (`"34"`, `"34:12"`, `"0:45"`, `"0"`, `"0:00"`, `"--"`)
 * into numeric minutes. Returns `0` for DNP / zero / unparseable inputs.
 */
export function parseMinutes(raw: string | undefined): number {
  if (typeof raw !== "string") return 0;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "--") return 0;

  if (/^\d+:\d{1,2}$/.test(trimmed)) {
    const [minsPart, secsPart] = trimmed.split(":");
    const mins = Number(minsPart);
    const secs = Number(secsPart);
    if (!Number.isFinite(mins) || !Number.isFinite(secs)) return 0;
    const total = mins + secs / 60;
    return total > 0 ? total : 0;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number(trimmed);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }

  return 0;
}

function normalizeEventDate(rawDate: unknown, fallbackDate?: string): string {
  if (typeof fallbackDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)) {
    return fallbackDate;
  }
  if (typeof rawDate === "string") {
    const trimmed = rawDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    if (/^\d{8}$/.test(trimmed)) {
      return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(parsed);
      const year = parts.find((p) => p.type === "year")?.value;
      const month = parts.find((p) => p.type === "month")?.value;
      const day = parts.find((p) => p.type === "day")?.value;
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
      return parsed.toISOString().slice(0, 10);
    }
  }
  return fallbackDate ?? "";
}

/**
 * Extracts NBA games from an ESPN `/scoreboard?dates=YYYYMMDD` payload,
 * normalizes competitor team abbreviations, filters to games involving at least
 * one team in `rosterTeams`, and identifies whether each game is `Final`.
 */
export function extractEventsFromScoreboard(
  scoreboardPayload: unknown,
  rosterTeams: ReadonlySet<string>,
  fallbackDate?: string,
): DiscoveredEspnGame[] {
  if (!isRecord(scoreboardPayload) || !Array.isArray(scoreboardPayload.events)) {
    throw new Error("ESPN scoreboard payload is missing events[] array");
  }

  const normalizedRosterTeams = new Set<string>();
  for (const t of rosterTeams) {
    normalizedRosterTeams.add(normalizeEspnTeam(t));
  }

  const payloadDayDate =
    isRecord(scoreboardPayload.day) && typeof scoreboardPayload.day.date === "string"
      ? scoreboardPayload.day.date
      : undefined;

  const discovered: DiscoveredEspnGame[] = [];

  for (const rawEvent of scoreboardPayload.events) {
    if (!isRecord(rawEvent)) continue;
    const eventId = String(rawEvent.id ?? "").trim();
    if (eventId === "") continue;

    const competitions = Array.isArray(rawEvent.competitions) ? rawEvent.competitions : [];
    const comp = isRecord(competitions[0]) ? competitions[0] : undefined;
    const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];

    let homeRaw = "";
    let awayRaw = "";
    for (const c of competitors) {
      if (!isRecord(c)) continue;
      const homeAway = typeof c.homeAway === "string" ? c.homeAway.toLowerCase() : "";
      const teamObj = isRecord(c.team) ? c.team : undefined;
      const abbr = typeof teamObj?.abbreviation === "string" ? teamObj.abbreviation : "";
      if (homeAway === "home") homeRaw = abbr;
      else if (homeAway === "away") awayRaw = abbr;
    }

    if (homeRaw === "" || awayRaw === "") continue;

    const homeTeam = normalizeEspnTeam(homeRaw);
    const awayTeam = normalizeEspnTeam(awayRaw);

    if (!normalizedRosterTeams.has(homeTeam) && !normalizedRosterTeams.has(awayTeam)) {
      continue;
    }

    const eventStatus = isRecord(rawEvent.status)
      ? rawEvent.status
      : isRecord(comp?.status)
        ? comp.status
        : undefined;
    const statusType = isRecord(eventStatus?.type) ? eventStatus.type : undefined;

    const completed = statusType?.completed === true;
    const description =
      typeof statusType?.description === "string" ? statusType.description.trim() : "";
    const statusName = typeof statusType?.name === "string" ? statusType.name.trim() : "";
    const isFinal =
      completed ||
      description.toLowerCase() === "final" ||
      statusName.toUpperCase() === "STATUS_FINAL";

    const statusDescription = description || (isFinal ? "Final" : statusName || "Scheduled");
    const date = normalizeEventDate(
      rawEvent.date ?? comp?.date ?? payloadDayDate,
      fallbackDate,
    );

    discovered.push({
      eventId,
      date,
      homeTeam,
      awayTeam,
      statusDescription,
      isFinal,
    });
  }

  return discovered;
}

function parseNonNegativeInt(raw: unknown, statLabel: string, playerName: string, eventId: string): number {
  const str = String(raw ?? "").trim();
  if (!/^\d+$/.test(str)) {
    throw new Error(
      `Invalid ${statLabel} stat value ${JSON.stringify(raw)} for ${playerName} in ESPN event ${eventId}`,
    );
  }
  const parsed = Number.parseInt(str, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${statLabel} stat value ${JSON.stringify(raw)} for ${playerName} in ESPN event ${eventId}`,
    );
  }
  return parsed;
}

/**
 * Extracts candidate `GameLog` entries and skipped DNP entries for mapped roster players
 * from an ESPN `/summary?event={eventId}` payload using dynamic column header lookup.
 */
export function extractPlayerBoxScoresFromSummary(
  summaryPayload: unknown,
  event: { eventId: string; date: string; homeTeam: string; awayTeam: string },
  mapByAthleteId: ReadonlyMap<string, EspnPlayerMapEntry>,
): { extracted: CandidateBoxScore[]; skippedDnp: SkippedGameEntry[] } {
  if (!isRecord(summaryPayload) || !isRecord(summaryPayload.boxscore)) {
    throw new Error(`ESPN summary payload for event ${event.eventId} is missing boxscore object`);
  }
  const playersBlocks = summaryPayload.boxscore.players;
  if (!Array.isArray(playersBlocks)) {
    throw new Error(
      `ESPN summary payload for event ${event.eventId} is missing boxscore.players[] array`,
    );
  }

  const homeTeam = normalizeEspnTeam(event.homeTeam);
  const awayTeam = normalizeEspnTeam(event.awayTeam);
  if (!VALID_NBA_TEAMS.has(homeTeam) || !VALID_NBA_TEAMS.has(awayTeam)) {
    throw new Error(
      `Invalid normalized team code(s) for event ${event.eventId}: away="${awayTeam}", home="${homeTeam}"`,
    );
  }

  const extracted: CandidateBoxScore[] = [];
  const skippedDnp: SkippedGameEntry[] = [];

  for (const teamBlock of playersBlocks) {
    if (!isRecord(teamBlock)) continue;
    const teamObj = isRecord(teamBlock.team) ? teamBlock.team : undefined;
    const rawTeamAbbr = typeof teamObj?.abbreviation === "string" ? teamObj.abbreviation : "";
    const blockTeam = rawTeamAbbr ? normalizeEspnTeam(rawTeamAbbr) : "";

    const statistics = Array.isArray(teamBlock.statistics) ? teamBlock.statistics : [];
    const statGroup = isRecord(statistics[0]) ? statistics[0] : undefined;
    if (!statGroup) continue;

    const rawHeaders = Array.isArray(statGroup.labels)
      ? statGroup.labels
      : Array.isArray(statGroup.names)
        ? statGroup.names
        : Array.isArray(statGroup.keys)
          ? statGroup.keys
          : [];
    const headers = rawHeaders.map((h) => String(h ?? "").trim().toUpperCase());

    const findCol = (candidates: string[]): number => {
      for (const c of candidates) {
        const idx = headers.indexOf(c);
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const minIdx = findCol(["MIN", "MINUTES"]);
    const ptsIdx = findCol(["PTS", "POINTS"]);
    const rebIdx = findCol(["REB", "REBOUNDS"]);
    const astIdx = findCol(["AST", "ASSISTS"]);
    const stlIdx = findCol(["STL", "STEALS"]);
    const blkIdx = findCol(["BLK", "BLOCKS"]);
    const tovIdx = findCol(["TO", "TOV", "TURNOVERS"]);

    const athletes = Array.isArray(statGroup.athletes) ? statGroup.athletes : [];
    for (const athleteEntry of athletes) {
      if (!isRecord(athleteEntry)) continue;
      const athleteObj = isRecord(athleteEntry.athlete) ? athleteEntry.athlete : undefined;
      const athleteId = String(athleteObj?.id ?? athleteEntry.id ?? "").trim();
      if (athleteId === "") continue;

      const mapped = mapByAthleteId.get(athleteId);
      if (!mapped) continue;

      const playerTeam = blockTeam || normalizeEspnTeam(mapped.espnTeam);
      const didNotPlay = athleteEntry.didNotPlay === true;
      const stats = athleteEntry.stats;
      const hasStats = Array.isArray(stats) && stats.length > 0;

      if (
        !didNotPlay &&
        hasStats &&
        (minIdx < 0 ||
          ptsIdx < 0 ||
          rebIdx < 0 ||
          astIdx < 0 ||
          stlIdx < 0 ||
          blkIdx < 0 ||
          tovIdx < 0)
      ) {
        throw new Error(
          `ESPN boxscore for event ${event.eventId} is missing required stat column headers (found: [${headers.join(", ")}])`,
        );
      }

      const minutes =
        !didNotPlay && hasStats && minIdx >= 0
          ? parseMinutes(typeof stats[minIdx] === "string" ? stats[minIdx] : String(stats[minIdx] ?? ""))
          : 0;

      if (didNotPlay || !hasStats || minutes <= 0) {
        const dnpReason =
          typeof athleteEntry.reason === "string" && athleteEntry.reason.trim() !== ""
            ? athleteEntry.reason.trim()
            : "0 minutes / DNP";
        skippedDnp.push({
          date: event.date,
          eventId: event.eventId,
          sleeperId: mapped.sleeperId,
          playerName: mapped.name,
          matchup: `${awayTeam} @ ${homeTeam}`,
          reason: "DNP",
          detail: dnpReason,
        });
        continue;
      }

      const pts = parseNonNegativeInt(stats[ptsIdx], "PTS", mapped.name, event.eventId);
      const reb = parseNonNegativeInt(stats[rebIdx], "REB", mapped.name, event.eventId);
      const ast = parseNonNegativeInt(stats[astIdx], "AST", mapped.name, event.eventId);
      const stl = parseNonNegativeInt(stats[stlIdx], "STL", mapped.name, event.eventId);
      const blk = parseNonNegativeInt(stats[blkIdx], "BLK", mapped.name, event.eventId);
      const tov = parseNonNegativeInt(stats[tovIdx], "TO", mapped.name, event.eventId);

      const isAway =
        playerTeam === awayTeam ||
        (playerTeam !== homeTeam && normalizeEspnTeam(mapped.espnTeam) === awayTeam);
      const opponent = isAway ? `@${homeTeam}` : awayTeam;

      const source = `ESPN box score ${event.eventId} ${event.date} ${awayTeam} @ ${homeTeam} (${pts}/${reb}/${ast}, ${stl} stl, ${blk} blk, ${tov} tov)`;

      const draftLog: GameLog = {
        sleeperId: mapped.sleeperId,
        date: event.date,
        opponent,
        pts,
        reb,
        ast,
        stl,
        blk,
        tov,
        source,
      };
      const expectedTotal = fantasyPoints(draftLog).total;
      const gameLog: GameLog = {
        ...draftLog,
        expectedTotal,
      };

      extracted.push({
        sleeperId: mapped.sleeperId,
        espnAthleteId: mapped.espnAthleteId,
        playerName: mapped.name,
        team: playerTeam,
        eventId: event.eventId,
        date: event.date,
        minutes,
        gameLog,
      });
    }
  }

  return { extracted, skippedDnp };
}

/**
 * Extracts Roster 1 (`roster_id === 1` by default) `players_points` map from either a
 * raw Sleeper `/matchups/{leg}` array payload or a pre-extracted `Record<string, number>`.
 */
export function extractRosterPlayersPoints(
  matchupPayloadOrPoints: unknown,
  rosterId = 1,
): Record<string, number> {
  if (Array.isArray(matchupPayloadOrPoints)) {
    const entry = matchupPayloadOrPoints.find(
      (item): item is Record<string, unknown> =>
        isRecord(item) && item.roster_id === rosterId,
    );
    if (!entry || !isRecord(entry.players_points)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(entry.players_points)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = round2(v);
      }
    }
    return out;
  }

  if (isRecord(matchupPayloadOrPoints)) {
    if (isRecord(matchupPayloadOrPoints.players_points)) {
      return extractRosterPlayersPoints([matchupPayloadOrPoints], Number(matchupPayloadOrPoints.roster_id ?? rosterId));
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(matchupPayloadOrPoints)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = round2(v);
      }
    }
    return out;
  }

  return {};
}

export interface ReconcileAndBuildReportParams {
  dates?: string[];
  verifyExisting?: boolean;
  discoveredGames?: DiscoveredEspnGame[];
  candidates: CandidateBoxScore[];
  skippedDnp?: SkippedGameEntry[];
  existingLogs: GameLog[];
  weeksFile: WeeksFile;
  locksFile: LocksFile;
  playersFile?: PlayersFile;
  sleeperMatchupsByLeg?: ReadonlyMap<number, unknown> | Record<number, unknown>;
  sleeperPlayersPointsByLeg?:
    | ReadonlyMap<number, Record<string, number>>
    | Record<number, Record<string, number>>;
  sleeperPlayersPoints?: Record<string, number>;
  errors?: string[];
  targetRosterId?: number;
}

function isMapLike<K, V>(v: ReadonlyMap<K, V> | Record<number, V>): v is ReadonlyMap<K, V> {
  return v instanceof Map;
}

function lookupLegPlayersPoints(
  leg: number,
  params: ReconcileAndBuildReportParams,
): Record<string, number> {
  const rosterId = params.targetRosterId ?? 1;

  if (params.sleeperPlayersPointsByLeg) {
    const fromMap = isMapLike(params.sleeperPlayersPointsByLeg)
      ? params.sleeperPlayersPointsByLeg.get(leg)
      : params.sleeperPlayersPointsByLeg[leg];
    if (fromMap) return extractRosterPlayersPoints(fromMap, rosterId);
  }

  if (params.sleeperMatchupsByLeg) {
    const raw = isMapLike(params.sleeperMatchupsByLeg)
      ? params.sleeperMatchupsByLeg.get(leg)
      : params.sleeperMatchupsByLeg[leg];
    if (raw !== undefined) return extractRosterPlayersPoints(raw, rosterId);
  }

  if (params.sleeperPlayersPoints) {
    return extractRosterPlayersPoints(params.sleeperPlayersPoints, rosterId);
  }

  return {};
}

const VERIFY_FIELDS = ["opponent", "pts", "reb", "ast", "stl", "blk", "tov"] as const;

/**
 * Reconciles extracted ESPN candidate box scores against `existingLogs`, `weeksFile`,
 * `locksFile`, and Sleeper's `players_points`, supporting both forward ingestion mode
 * and `--verify-existing` audit mode.
 */
export function reconcileAndBuildReport(
  params: ReconcileAndBuildReportParams,
): EspnIngestionReport {
  const verifyExisting = params.verifyExisting === true;
  const discoveredGames = params.discoveredGames ?? [];
  const skipped: SkippedGameEntry[] = [];

  for (const game of discoveredGames) {
    if (!game.isFinal) {
      skipped.push({
        date: game.date,
        eventId: game.eventId,
        matchup: `${game.awayTeam} @ ${game.homeTeam}`,
        reason: "not Final",
        detail: game.statusDescription,
      });
    }
  }

  if (params.skippedDnp) {
    skipped.push(...params.skippedDnp);
  }

  const playerNamesById = new Map<string, string>();
  if (params.playersFile) {
    for (const p of params.playersFile.players) {
      playerNamesById.set(p.sleeperId, p.name);
    }
  }
  for (const c of params.candidates) {
    if (!playerNamesById.has(c.sleeperId)) {
      playerNamesById.set(c.sleeperId, c.playerName);
    }
  }

  const existingByKey = new Map<string, GameLog>();
  for (const log of params.existingLogs) {
    existingByKey.set(`${log.sleeperId}|${log.date}`, log);
  }

  const proposedCandidates: CandidateBoxScore[] = [];
  const verifiedExisting: VerifyExistingEntry[] = [];
  const verifyDiffFlags: string[] = [];

  for (const candidate of params.candidates) {
    const key = `${candidate.sleeperId}|${candidate.date}`;
    const committed = existingByKey.get(key);
    const playerName =
      playerNamesById.get(candidate.sleeperId) ?? candidate.playerName ?? candidate.sleeperId;

    if (committed) {
      if (!verifyExisting) {
        skipped.push({
          date: candidate.date,
          eventId: candidate.eventId,
          sleeperId: candidate.sleeperId,
          playerName,
          reason: "already logged",
          detail: `${committed.opponent} (${committed.pts}/${committed.reb}/${committed.ast})`,
        });
        continue;
      }

      const diffs: string[] = [];
      for (const field of VERIFY_FIELDS) {
        if (committed[field] !== candidate.gameLog[field]) {
          diffs.push(
            `${field}: committed ${JSON.stringify(committed[field])} vs ESPN ${JSON.stringify(candidate.gameLog[field])}`,
          );
        }
      }

      if (diffs.length === 0) {
        verifiedExisting.push({
          sleeperId: candidate.sleeperId,
          playerName,
          date: candidate.date,
          status: "VERIFIED",
          committedLog: committed,
          espnLog: candidate.gameLog,
          diffs: [],
        });
      } else {
        const flag = `VERIFY_DIFF: ${playerName} (${candidate.sleeperId}) ${candidate.date} — ${diffs.join(", ")}`;
        verifyDiffFlags.push(flag);
        verifiedExisting.push({
          sleeperId: candidate.sleeperId,
          playerName,
          date: candidate.date,
          status: "VERIFY_DIFF",
          committedLog: committed,
          espnLog: candidate.gameLog,
          diffs,
          flag,
        });
      }
      continue;
    }

    proposedCandidates.push(candidate);
  }

  const proposedLogs = proposedCandidates.map((c) => c.gameLog);

  // Build combined played dates per player to determine latest played game in each leg
  const allPlayedDatesByPlayer = new Map<string, Set<string>>();
  const addPlayedDate = (sleeperId: string, date: string) => {
    let set = allPlayedDatesByPlayer.get(sleeperId);
    if (!set) {
      set = new Set<string>();
      allPlayedDatesByPlayer.set(sleeperId, set);
    }
    set.add(date);
  };
  for (const log of params.existingLogs) {
    addPlayedDate(log.sleeperId, log.date);
  }
  for (const log of proposedLogs) {
    addPlayedDate(log.sleeperId, log.date);
  }

  const findWeekForDate = (date: string): WeekRecord | undefined =>
    params.weeksFile.weeks.find((w) => w.startDate <= date && date <= w.endDate);

  const lockedPlayerLegs = new Set(
    params.locksFile.locks.map((l) => `${l.sleeperId}|${l.leg}`),
  );

  const reconciliations: ProposedLogReconciliation[] = [];
  const reconcileFlags: string[] = [];

  for (const candidate of proposedCandidates) {
    const { gameLog } = candidate;
    const playerName =
      playerNamesById.get(candidate.sleeperId) ?? candidate.playerName ?? candidate.sleeperId;
    const computedTotal = round2(fantasyPoints(gameLog).total);
    const week = findWeekForDate(gameLog.date);

    if (!week) {
      const fallbackPts = params.sleeperPlayersPoints?.[gameLog.sleeperId];
      const sleeperTotal =
        typeof fallbackPts === "number" && Number.isFinite(fallbackPts)
          ? round2(fallbackPts)
          : null;
      reconciliations.push({
        gameLog,
        playerName,
        computedTotal,
        sleeperTotal,
        diff: sleeperTotal !== null ? round2(computedTotal - sleeperTotal) : null,
        leg: null,
        scope: "NO_WEEK",
        status: "INFO",
      });
      continue;
    }

    const legPoints = lookupLegPlayersPoints(week.leg, params);
    const hasLegSleeperData = Object.keys(legPoints).length > 0;
    const rawSleeperPts = legPoints[gameLog.sleeperId];
    const sleeperTotal =
      typeof rawSleeperPts === "number" && Number.isFinite(rawSleeperPts)
        ? round2(rawSleeperPts)
        : null;

    const isLocked = lockedPlayerLegs.has(`${gameLog.sleeperId}|${week.leg}`);
    const playerDatesInLeg = [...(allPlayedDatesByPlayer.get(gameLog.sleeperId) ?? [])]
      .filter((d) => week.startDate <= d && d <= week.endDate)
      .sort();
    const latestDateInLeg = playerDatesInLeg[playerDatesInLeg.length - 1] ?? gameLog.date;
    const isLatestInLeg = gameLog.date >= latestDateInLeg;

    let scope: ReconciliationScope;
    if (isLocked) {
      scope = "LOCKED";
    } else if (!isLatestInLeg) {
      scope = "EARLIER_IN_LEG";
    } else {
      scope = "UNLOCKED_LATEST_IN_LEG";
    }

    const diff = sleeperTotal !== null ? round2(computedTotal - sleeperTotal) : null;

    if (scope === "UNLOCKED_LATEST_IN_LEG" && sleeperTotal !== null) {
      if (computedTotal === sleeperTotal) {
        reconciliations.push({
          gameLog,
          playerName,
          computedTotal,
          sleeperTotal,
          diff: 0,
          leg: week.leg,
          scope,
          status: "MATCH",
        });
      } else {
        const diffVal = round2(computedTotal - sleeperTotal);
        const diffFormatted = `${diffVal >= 0 ? "+" : ""}${diffVal.toFixed(2)}`;
        const flag = `RECONCILE: ${playerName} (${gameLog.sleeperId}) ${gameLog.date} computed ${computedTotal.toFixed(2)} vs Sleeper ${sleeperTotal.toFixed(2)} (diff ${diffFormatted})`;
        reconcileFlags.push(flag);
        reconciliations.push({
          gameLog,
          playerName,
          computedTotal,
          sleeperTotal,
          diff: diffVal,
          leg: week.leg,
          scope,
          status: "RECONCILE",
          flag,
        });
      }
    } else if (scope === "UNLOCKED_LATEST_IN_LEG" && hasLegSleeperData && sleeperTotal === null) {
      const flag = `RECONCILE: ${playerName} (${gameLog.sleeperId}) ${gameLog.date} computed ${computedTotal.toFixed(2)} vs Sleeper missing (not in Roster 1 players_points)`;
      reconcileFlags.push(flag);
      reconciliations.push({
        gameLog,
        playerName,
        computedTotal,
        sleeperTotal: null,
        diff: null,
        leg: week.leg,
        scope,
        status: "RECONCILE",
        flag,
      });
    } else {
      reconciliations.push({
        gameLog,
        playerName,
        computedTotal,
        sleeperTotal,
        diff,
        leg: week.leg,
        scope,
        status: "INFO",
      });
    }
  }

  const errors = [...(params.errors ?? [])];
  const hasFailures =
    reconcileFlags.length > 0 || verifyDiffFlags.length > 0 || errors.length > 0;

  const dates =
    params.dates && params.dates.length > 0
      ? [...params.dates]
      : [...new Set(params.candidates.map((c) => c.date))].sort();

  return {
    dates,
    verifyExisting,
    discoveredGames,
    proposedLogs,
    reconciliations,
    verifiedExisting,
    skipped,
    reconcileFlags,
    verifyDiffFlags,
    errors,
    hasFailures,
  };
}

/**
 * Validates that `--out <path>` never resolves inside `<repoRoot>/data`,
 * protecting committed `data/*.json` files from accidental overwrite.
 */
export function validateSafeOutPath(outPath: string, repoRoot = process.cwd()): string {
  if (typeof outPath !== "string" || outPath.trim() === "") {
    throw new Error("Output path (--out) must be a non-empty path string");
  }
  const resolvedRoot = resolve(repoRoot);
  const resolvedDataDir = resolve(resolvedRoot, "data");
  const resolvedOut = resolve(resolvedRoot, outPath.trim());

  const rel = relative(resolvedDataDir, resolvedOut);
  const isInsideDataDir =
    resolvedOut === resolvedDataDir ||
    resolvedOut.startsWith(`${resolvedDataDir}${sep}`) ||
    (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));

  if (isInsideDataDir) {
    throw new Error(
      `Refusing to write to "${outPath}" (${resolvedOut}): output paths inside data/ are forbidden to protect committed data files.`,
    );
  }

  return resolvedOut;
}

/**
 * Formats the human-readable ingestion & reconciliation report plus the JSON array of `proposedLogs`.
 */
export function formatIngestionReport(report: EspnIngestionReport): string {
  const lines: string[] = [];
  lines.push("=== Netrics ESPN Game-Log Ingestion Report ===");
  lines.push(
    `Dates: ${report.dates.length > 0 ? report.dates.join(", ") : "none"} | Mode: ${
      report.verifyExisting ? "verify-existing" : "forward"
    }`,
  );
  lines.push(
    `Summary: ${report.proposedLogs.length} proposed, ${report.verifiedExisting.length} verified-existing, ${report.skipped.length} skipped, ${report.reconcileFlags.length} reconcile flag(s), ${report.verifyDiffFlags.length} verify-diff flag(s)`,
  );

  if (report.reconciliations.length > 0) {
    lines.push("Proposed Logs & Sleeper Reconciliation:");
    for (const r of report.reconciliations) {
      const g = r.gameLog;
      const sleeperStr =
        r.sleeperTotal !== null ? `Sleeper ${r.sleeperTotal.toFixed(2)}` : "Sleeper n/a";
      lines.push(
        `  - [${r.status}] ${r.playerName} (${g.sleeperId}) ${g.date} ${g.opponent}: ${g.pts}/${g.reb}/${g.ast}, ${g.stl} stl, ${g.blk} blk, ${g.tov} tov -> ${r.computedTotal.toFixed(2)} (${sleeperStr}, ${r.scope})`,
      );
    }
  }

  if (report.verifiedExisting.length > 0) {
    lines.push("Existing Log Verification (--verify-existing):");
    for (const v of report.verifiedExisting) {
      if (v.status === "VERIFIED") {
        lines.push(
          `  - [VERIFIED] ${v.playerName} (${v.sleeperId}) ${v.date} ${v.committedLog.opponent} matches ESPN (${v.espnLog.pts}/${v.espnLog.reb}/${v.espnLog.ast}, ${v.espnLog.stl} stl, ${v.espnLog.blk} blk, ${v.espnLog.tov} tov)`,
        );
      } else {
        lines.push(`  - [VERIFY_DIFF] ${v.flag}`);
      }
    }
  }

  if (report.skipped.length > 0) {
    lines.push("Skipped Entries:");
    for (const s of report.skipped) {
      const who = s.playerName
        ? `${s.playerName} (${s.sleeperId})`
        : s.matchup ?? s.eventId ?? "game";
      const detail = s.detail ? ` — ${s.detail}` : "";
      lines.push(`  - SKIP [${s.reason}] ${s.date} ${who}${detail}`);
    }
  }

  if (
    report.reconcileFlags.length > 0 ||
    report.verifyDiffFlags.length > 0 ||
    report.errors.length > 0
  ) {
    lines.push("Flags & Errors:");
    for (const f of report.reconcileFlags) lines.push(`  - ${f}`);
    for (const f of report.verifyDiffFlags) lines.push(`  - ${f}`);
    for (const e of report.errors) lines.push(`  - ERROR: ${e}`);
  }

  lines.push(`Status: ${report.hasFailures ? "FAILED (exit 1)" : "OK (exit 0)"}`);
  lines.push(`Proposed GameLog[] (${report.proposedLogs.length}):`);
  lines.push(JSON.stringify(report.proposedLogs, null, 2));

  return lines.join("\n");
}

export interface RunEspnIngestionOptions {
  dates: string[];
  verifyExisting?: boolean;
  playersFile: PlayersFile;
  espnPlayerMap: EspnPlayerMapFile;
  existingLogs: GameLog[];
  weeksFile: WeeksFile;
  locksFile: LocksFile;
  fetchImpl?: typeof fetch;
  leagueId?: string;
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * Fetches ESPN scoreboards + summaries and Sleeper leg matchups for the requested
 * `YYYY-MM-DD` date(s) and produces the full `EspnIngestionReport`.
 */
export async function runEspnIngestion(
  options: RunEspnIngestionOptions,
): Promise<EspnIngestionReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const leagueId = options.leagueId ?? options.playersFile.leagueId ?? LEAGUE_ID;

  const rosterTeams = new Set<string>();
  for (const p of options.playersFile.players) {
    rosterTeams.add(normalizeEspnTeam(p.team));
  }
  for (const m of options.espnPlayerMap.players) {
    rosterTeams.add(normalizeEspnTeam(m.espnTeam));
  }

  const mapByAthleteId = new Map<string, EspnPlayerMapEntry>();
  for (const entry of options.espnPlayerMap.players) {
    mapByAthleteId.set(entry.espnAthleteId, entry);
  }

  const discoveredGames: DiscoveredEspnGame[] = [];
  const candidates: CandidateBoxScore[] = [];
  const skippedDnp: SkippedGameEntry[] = [];

  for (const date of options.dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid --date "${date}": expected YYYY-MM-DD`);
    }
    const yyyymmdd = date.replace(/-/g, "");
    const scoreboardUrl = `${ESPN_NBA_BASE_URL}/scoreboard?dates=${yyyymmdd}`;
    const scoreboardPayload = await fetchJson(scoreboardUrl, fetchImpl);
    const gamesForDate = extractEventsFromScoreboard(scoreboardPayload, rosterTeams, date);
    discoveredGames.push(...gamesForDate);

    for (const game of gamesForDate) {
      if (!game.isFinal) continue;
      const summaryUrl = `${ESPN_NBA_BASE_URL}/summary?event=${encodeURIComponent(game.eventId)}`;
      const summaryPayload = await fetchJson(summaryUrl, fetchImpl);
      const extracted = extractPlayerBoxScoresFromSummary(summaryPayload, game, mapByAthleteId);
      candidates.push(...extracted.extracted);
      skippedDnp.push(...extracted.skippedDnp);
    }
  }

  // Only fetch Sleeper matchups for legs that have at least one new proposed candidate
  const existingKeys = new Set(options.existingLogs.map((l) => `${l.sleeperId}|${l.date}`));
  const legsToFetch = new Set<number>();
  for (const c of candidates) {
    if (existingKeys.has(`${c.sleeperId}|${c.date}`)) continue;
    const week = options.weeksFile.weeks.find(
      (w) => w.startDate <= c.date && c.date <= w.endDate,
    );
    if (week) legsToFetch.add(week.leg);
  }

  const sleeperMatchupsByLeg = new Map<number, unknown>();
  for (const leg of legsToFetch) {
    const matchupUrl = `${SLEEPER_BASE_URL}/league/${leagueId}/matchups/${leg}`;
    const matchupPayload = await fetchJson(matchupUrl, fetchImpl);
    sleeperMatchupsByLeg.set(leg, matchupPayload);
  }

  return reconcileAndBuildReport({
    dates: options.dates,
    verifyExisting: options.verifyExisting === true,
    discoveredGames,
    candidates,
    skippedDnp,
    existingLogs: options.existingLogs,
    weeksFile: options.weeksFile,
    locksFile: options.locksFile,
    playersFile: options.playersFile,
    sleeperMatchupsByLeg,
  });
}

export interface EasternDateWindow {
  yesterday: string;
  today: string;
  dates: [string, string];
}

/**
 * Computes `[yesterday, today]` in `America/New_York` (`YYYY-MM-DD`).
 * Uses UTC noon calendar arithmetic on the Eastern `today` date string so
 * DST transitions and month/year boundaries never skip or duplicate a day.
 */
export function computeEasternDateWindow(now: Date = new Date()): EasternDateWindow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const today = `${year}-${month}-${day}`;

  const utcNoon = new Date(`${today}T12:00:00Z`);
  utcNoon.setUTCDate(utcNoon.getUTCDate() - 1);
  const yesterday = utcNoon.toISOString().slice(0, 10);

  return {
    yesterday,
    today,
    dates: [yesterday, today],
  };
}

export interface ApplyIngestionProposalParams {
  report: EspnIngestionReport;
  playersFile: PlayersFile;
  existingLogs: GameLog[];
  weeksFile: WeeksFile;
  espnPlayerMap?: EspnPlayerMapFile;
}

export interface ApplyIngestionProposalResult {
  updatedLogs: GameLog[];
  updatedWeeks: WeeksFile;
  updatedPlayers: PlayersFile;
}

/**
 * Pure helper that applies an `EspnIngestionReport` to cloned copies of
 * `existingLogs`, `weeksFile`, and `playersFile`:
 * 1. If `report.proposedLogs` is empty, returns clones of existing inputs untouched.
 * 2. Appends `report.proposedLogs` (deduplicated on `(sleeperId, date)`) to `existingLogs`.
 * 3. Removes completed (`Final`) game dates from `week.remainingGames[sleeperId]` for all
 *    rostered players on teams whose game completed on that date (including DNP teammates).
 * 4. Advances `updatedPlayers.asOf` to `max(playersFile.asOf, maxProposedDate)`.
 */
export function applyIngestionProposal(
  params: ApplyIngestionProposalParams,
): ApplyIngestionProposalResult {
  const updatedLogs: GameLog[] = params.existingLogs.map((l) => ({ ...l }));
  const updatedWeeks: WeeksFile = structuredClone(params.weeksFile);
  const updatedPlayers: PlayersFile = structuredClone(params.playersFile);

  if (params.report.proposedLogs.length === 0) {
    return {
      updatedLogs,
      updatedWeeks,
      updatedPlayers,
    };
  }

  const seenLogKeys = new Set<string>(
    updatedLogs.map((l) => `${l.sleeperId}|${l.date}`),
  );
  for (const proposed of params.report.proposedLogs) {
    const key = `${proposed.sleeperId}|${proposed.date}`;
    if (!seenLogKeys.has(key)) {
      seenLogKeys.add(key);
      updatedLogs.push({ ...proposed });
    }
  }

  const teamBySleeperId = new Map<string, string>();
  for (const player of params.playersFile.players) {
    teamBySleeperId.set(player.sleeperId, normalizeEspnTeam(player.team));
  }
  if (params.espnPlayerMap) {
    for (const mapped of params.espnPlayerMap.players) {
      if (!teamBySleeperId.has(mapped.sleeperId)) {
        teamBySleeperId.set(mapped.sleeperId, normalizeEspnTeam(mapped.espnTeam));
      }
    }
  }

  const completedTeamDates = new Set<string>();
  const proposedPlayerDates = new Set<string>();

  for (const log of params.report.proposedLogs) {
    proposedPlayerDates.add(`${log.sleeperId}|${log.date}`);
    const team = teamBySleeperId.get(log.sleeperId);
    if (team) {
      completedTeamDates.add(`${team}|${log.date}`);
    }
  }

  for (const game of params.report.discoveredGames) {
    if (game.isFinal) {
      completedTeamDates.add(`${normalizeEspnTeam(game.homeTeam)}|${game.date}`);
      completedTeamDates.add(`${normalizeEspnTeam(game.awayTeam)}|${game.date}`);
    }
  }

  for (const week of updatedWeeks.weeks) {
    for (const [sleeperId, dates] of Object.entries(week.remainingGames)) {
      const team = teamBySleeperId.get(sleeperId);
      week.remainingGames[sleeperId] = dates.filter((d) => {
        if (proposedPlayerDates.has(`${sleeperId}|${d}`)) return false;
        if (team && completedTeamDates.has(`${team}|${d}`)) return false;
        return true;
      });
    }
  }

  let maxAsOf = updatedPlayers.asOf;
  for (const log of params.report.proposedLogs) {
    if (log.date > maxAsOf) {
      maxAsOf = log.date;
    }
  }
  updatedPlayers.asOf = maxAsOf;

  return {
    updatedLogs,
    updatedWeeks,
    updatedPlayers,
  };
}

export interface NightlyPrMetadata {
  branchName: string;
  title: string;
  body: string;
  hasReconcileFlags: boolean;
}

/**
 * Builds deterministic branch name, PR title, and Markdown PR body for the nightly
 * ingestion workflow (`docs/design/NETRICS-DESIGN.md` §9.5 & ADR-0006).
 */
export function buildNightlyPrMetadata(
  report: EspnIngestionReport,
  fallbackDate?: string,
): NightlyPrMetadata {
  const proposedDates = [...new Set(report.proposedLogs.map((l) => l.date))].sort();
  const reportDates = [...report.dates].sort();
  const maxDate =
    proposedDates[proposedDates.length - 1] ??
    (fallbackDate && fallbackDate.trim() !== "" ? fallbackDate.trim() : undefined) ??
    reportDates[reportDates.length - 1] ??
    computeEasternDateWindow().today;

  const branchName = `ingest/${maxDate}`;
  const hasReconcileFlags = report.reconcileFlags.length > 0;
  const title = hasReconcileFlags
    ? `data: ingest game logs for ${maxDate} (⚠ reconcile)`
    : `data: ingest game logs for ${maxDate}`;

  const lines: string[] = [];

  if (hasReconcileFlags) {
    lines.push("## ⚠ Reconciliation Flags");
    lines.push("");
    for (const flag of report.reconcileFlags) {
      const normalized = flag.replace(/^\[RECONCILE\]\s*|^RECONCILE:\s*/, "");
      lines.push(`- [RECONCILE] ${normalized}`);
    }
    lines.push("");
  }

  lines.push(`## Proposed Game Logs (${report.proposedLogs.length})`);
  lines.push("");
  if (report.proposedLogs.length === 0) {
    lines.push("_No new game logs proposed._");
    lines.push("");
  } else {
    lines.push(
      "| Player | Sleeper ID | Date | Opponent | Box Score (PTS/REB/AST/STL/BLK/TOV) | Fantasy Pts | Source |",
    );
    lines.push("|---|---|---|---|---|---|---|");
    const recByKey = new Map<string, ProposedLogReconciliation>(
      report.reconciliations.map((r) => [`${r.gameLog.sleeperId}|${r.gameLog.date}`, r]),
    );
    for (const log of report.proposedLogs) {
      const rec = recByKey.get(`${log.sleeperId}|${log.date}`);
      const playerName = rec?.playerName ?? log.sleeperId;
      const total = fantasyPoints(log).total.toFixed(2);
      const boxLine = `${log.pts}/${log.reb}/${log.ast}/${log.stl}/${log.blk}/${log.tov}`;
      lines.push(
        `| ${playerName} | \`${log.sleeperId}\` | ${log.date} | \`${log.opponent}\` | \`${boxLine}\` | **${total}** | ${log.source} |`,
      );
    }
    lines.push("");
  }

  const eventsScanned = report.discoveredGames.length;
  const finalEventsProcessed = report.discoveredGames.filter((g) => g.isFinal).length;
  const nonFinalEventsSkipped = report.skipped.filter((s) => s.reason === "not Final").length;
  const existingLogsSkipped = report.skipped.filter((s) => s.reason === "already logged").length;
  const dnpPlayersSkipped = report.skipped.filter((s) => s.reason === "DNP").length;

  lines.push("## Date Summary");
  lines.push("");
  lines.push(
    `- **datesRequested:** ${report.dates.length > 0 ? report.dates.join(", ") : "none"}`,
  );
  lines.push(`- **eventsScanned:** ${eventsScanned}`);
  lines.push(`- **finalEventsProcessed:** ${finalEventsProcessed}`);
  lines.push(`- **nonFinalEventsSkipped:** ${nonFinalEventsSkipped}`);
  lines.push(`- **existingLogsSkipped:** ${existingLogsSkipped}`);
  lines.push(`- **dnpPlayersSkipped:** ${dnpPlayersSkipped}`);
  lines.push("");
  lines.push("<details>");
  lines.push("<summary>Full Ingestion & Reconciliation Report</summary>");
  lines.push("");
  lines.push("```text");
  lines.push(formatIngestionReport(report));
  lines.push("```");
  lines.push("</details>");

  return {
    branchName,
    title,
    body: lines.join("\n"),
    hasReconcileFlags,
  };
}

