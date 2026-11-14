// Stage 5b / ADR-0007 — Automated Sleeper Roster & Week Sync Apply Engine
// (`docs/design/NETRICS-DESIGN.md` §8.3, `docs/decisions/0007-auto-roster-week-sync-and-espn-backfill.md`).
//
// Applies Sleeper Roster 1 and `state/nba.leg` changes to `PlayersFile`, `WeeksFile`,
// and `EspnPlayerMapFile`. Never modifies `data/locks.json` or `data/game-logs.json`.

import { writeFileSync } from "node:fs";
import {
  loadEspnPlayerMap,
  loadGameLogs,
  loadPlayers,
  loadWeeks,
} from "../data/load.js";
import {
  LEAGUE_ID,
  STARTER_SLOTS,
  type EspnPlayerMapEntry,
  type EspnPlayerMapFile,
  type GameLog,
  type OpponentPlayerScore,
  type Player,
  type PlayersFile,
  type RosterStatus,
  type WeekRecord,
  type WeeksFile,
} from "../data/types.js";
import {
  VALID_NBA_TEAMS,
  isPositionEligibleForSlot,
  normalizeEspnTeam,
} from "../data/validate.js";
import {
  ESPN_NBA_BASE_URL,
  computeEasternDateWindow,
  extractEventsFromScoreboard,
} from "../espn/ingest.js";
import { round2 } from "../scoring/index.js";
import { parseLiveMatchup } from "./liveMatchup.js";
import {
  buildSyncReport,
  type SleeperNbaState,
  type SleeperPlayerMeta,
  type SleeperRosterEntry,
  type SleeperTransactionEntry,
  type SyncReportResult,
} from "./syncReport.js";

export interface SleeperUserEntry {
  user_id: string;
  display_name?: string;
  username?: string;
}

export interface SyncPrMetadata {
  changed: boolean;
  hasActionableDiffs: boolean;
  leg: number;
  branchName: string;
  title: string;
  body: string;
}

export interface SyncApplyInput {
  state: SleeperNbaState;
  rosters: SleeperRosterEntry[];
  users: SleeperUserEntry[];
  transactions: SleeperTransactionEntry[];
  matchups: unknown;
  sleeperPlayers: Record<string, SleeperPlayerMeta>;
  playersFile: PlayersFile;
  weeksFile: WeeksFile;
  espnPlayerMapFile: EspnPlayerMapFile;
  gameLogs: GameLog[];
  targetRosterId?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export interface SyncApplyResult {
  updatedPlayers: PlayersFile;
  updatedWeeks: WeeksFile;
  updatedEspnPlayerMap: EspnPlayerMapFile;
  report: SyncReportResult;
  prMetadata: SyncPrMetadata;
  addedPlayers: Player[];
  retainedDroppedPlayers: Player[];
  removedDroppedPlayerIds: string[];
  createdNewLeg: boolean;
  playersChanged: boolean;
  weeksChanged: boolean;
  mapChanged: boolean;
  changed: boolean;
}

const ESPN_SEARCH_URL = "https://site.api.espn.com/apis/common/v3/search";
const VALID_FANTASY_POSITIONS = new Set(["PG", "SG", "SF", "PF", "C"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TEAM_TO_ESPN_SLUGS: Record<string, string[]> = {
  GSW: ["gs", "gsw"],
  NYK: ["ny", "nyk"],
  NOP: ["no", "nop"],
  SAS: ["sa", "sas"],
  UTA: ["utah", "uta"],
  WAS: ["wsh", "was"],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidDateString(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}

export function addCalendarDays(dateStr: string, deltaDays: number): string {
  const utcNoon = new Date(`${dateStr}T12:00:00Z`);
  utcNoon.setUTCDate(utcNoon.getUTCDate() + deltaDays);
  return utcNoon.toISOString().slice(0, 10);
}

export function listCalendarDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    dates.push(cur);
    cur = addCalendarDays(cur, 1);
  }
  return dates;
}

export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripNameSuffix(normalized: string): string {
  return normalized.replace(/\b(jr|sr|ii|iii|iv|v)\b$/g, "").trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  if (na === "" || nb === "") return false;
  if (na === nb) return true;
  return stripNameSuffix(na) === stripNameSuffix(nb);
}

function resolveSleeperName(
  sleeperId: string,
  meta: SleeperPlayerMeta | undefined,
): string {
  const full =
    meta?.full_name?.trim() ||
    [meta?.first_name, meta?.last_name].filter(Boolean).join(" ").trim();
  if (!full) {
    throw new Error(`Sleeper player metadata missing name for sleeperId "${sleeperId}"`);
  }
  return full;
}

function resolveSleeperPositions(
  sleeperId: string,
  meta: SleeperPlayerMeta | undefined,
  existing?: Player,
): string[] {
  if (Array.isArray(meta?.fantasy_positions) && meta.fantasy_positions.length > 0) {
    const filtered = meta.fantasy_positions
      .map((p) => p.trim().toUpperCase())
      .filter((p) => VALID_FANTASY_POSITIONS.has(p));
    if (filtered.length > 0) return filtered;
  }
  if (typeof meta?.position === "string" && meta.position.trim() !== "") {
    const pos = meta.position.trim().toUpperCase();
    if (VALID_FANTASY_POSITIONS.has(pos)) return [pos];
  }
  if (existing && existing.positions.length > 0) {
    return [...existing.positions];
  }
  throw new Error(`Sleeper player metadata missing valid positions for sleeperId "${sleeperId}"`);
}

function resolveSleeperTeam(
  sleeperId: string,
  meta: SleeperPlayerMeta | undefined,
  existing?: Player,
): string {
  if (typeof meta?.team === "string" && meta.team.trim() !== "") {
    const normalized = normalizeEspnTeam(meta.team);
    if (VALID_NBA_TEAMS.has(normalized)) {
      return normalized;
    }
  }
  if (existing && VALID_NBA_TEAMS.has(existing.team)) {
    return existing.team;
  }
  throw new Error(
    `Sleeper player metadata missing valid NBA team for sleeperId "${sleeperId}" (got ${JSON.stringify(meta?.team ?? null)})`,
  );
}

export function deriveLegDates(
  leg: number,
  weeksFile: WeeksFile,
  state: SleeperNbaState,
): { startDate: string; endDate: string } {
  const existing = weeksFile.weeks.find((w) => w.leg === leg);
  if (existing) {
    return { startDate: existing.startDate, endDate: existing.endDate };
  }

  if (weeksFile.weeks.length > 0) {
    const sorted = [...weeksFile.weeks].sort((a, b) => b.leg - a.leg);
    const latest = sorted[0]!;
    const deltaWeeks = leg - latest.leg;
    const startDate = addCalendarDays(latest.startDate, deltaWeeks * 7);
    const endDate = addCalendarDays(startDate, 6);
    return { startDate, endDate };
  }

  if (isValidDateString(state.season_start_date)) {
    const startDate = addCalendarDays(state.season_start_date, (leg - 1) * 7);
    const endDate = addCalendarDays(startDate, 6);
    return { startDate, endDate };
  }

  throw new Error(
    `Cannot derive startDate/endDate for leg ${leg}: weeks.json is empty and state.season_start_date is missing`,
  );
}

async function fetchJsonSafe(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    return { ok: false, status: res.status, data: null };
  }
  const data: unknown = await res.json();
  return { ok: true, status: res.status, data };
}

function extractAthletesFromRosterPayload(
  payload: unknown,
): { id: string; name: string; teamAbbr?: string }[] {
  if (!isRecord(payload)) return [];
  const teamObj = isRecord(payload.team) ? payload.team : undefined;
  const defaultTeam =
    typeof teamObj?.abbreviation === "string" ? teamObj.abbreviation : undefined;

  const rawAthletes = Array.isArray(payload.athletes) ? payload.athletes : [];
  const out: { id: string; name: string; teamAbbr?: string }[] = [];

  for (const item of rawAthletes) {
    if (!isRecord(item)) continue;
    // Some ESPN roster payloads group under { position, items: [...] }
    if (Array.isArray(item.items)) {
      for (const sub of item.items) {
        if (!isRecord(sub)) continue;
        const id = String(sub.id ?? "").trim();
        const name = String(sub.fullName ?? sub.displayName ?? "").trim();
        if (id && name) {
          out.push({ id, name, ...(defaultTeam ? { teamAbbr: defaultTeam } : {}) });
        }
      }
      continue;
    }
    const id = String(item.id ?? "").trim();
    const name = String(item.fullName ?? item.displayName ?? "").trim();
    if (id && name) {
      out.push({ id, name, ...(defaultTeam ? { teamAbbr: defaultTeam } : {}) });
    }
  }
  return out;
}

function extractAthletesFromSearchPayload(
  payload: unknown,
): { id: string; name: string; teamAbbr?: string }[] {
  if (!isRecord(payload)) return [];
  const candidates: unknown[] = [];
  if (Array.isArray(payload.items)) {
    candidates.push(...payload.items);
  }
  if (Array.isArray(payload.results)) {
    for (const group of payload.results) {
      if (isRecord(group) && Array.isArray(group.contents)) {
        candidates.push(...group.contents);
      }
    }
  }

  const out: { id: string; name: string; teamAbbr?: string }[] = [];
  for (const item of candidates) {
    if (!isRecord(item)) continue;
    const rawId = String(item.id ?? item.uid ?? "").trim();
    // Handle uid like "s:40~l:46~a:4432166" if id is absent
    const idMatch = /(\d+)$/.exec(rawId);
    const id = /^\d+$/.test(rawId) ? rawId : (idMatch?.[1] ?? "");
    const name = String(item.displayName ?? item.fullName ?? item.name ?? "").trim();
    let teamAbbr: string | undefined;
    if (isRecord(item.team) && typeof item.team.abbreviation === "string") {
      teamAbbr = item.team.abbreviation;
    } else if (Array.isArray(item.teamRelationships)) {
      const firstRel = item.teamRelationships[0];
      if (
        isRecord(firstRel) &&
        isRecord(firstRel.core) &&
        typeof firstRel.core.abbreviation === "string"
      ) {
        teamAbbr = firstRel.core.abbreviation;
      }
    }
    if (id && name) {
      out.push({ id, name, ...(teamAbbr ? { teamAbbr } : {}) });
    }
  }
  return out;
}

export async function resolveEspnAthleteForPlayer(
  player: Player,
  usedAthleteIds: ReadonlySet<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<EspnPlayerMapEntry> {
  const slugs = TEAM_TO_ESPN_SLUGS[player.team] ?? [player.team.toLowerCase()];

  for (const slug of slugs) {
    const rosterUrl = `${ESPN_NBA_BASE_URL}/teams/${encodeURIComponent(slug)}/roster`;
    const res = await fetchJsonSafe(rosterUrl, fetchImpl);
    if (!res.ok) continue;

    const athletes = extractAthletesFromRosterPayload(res.data);
    const match = athletes.find(
      (a) => /^\d+$/.test(a.id) && !usedAthleteIds.has(a.id) && namesMatch(a.name, player.name),
    );
    if (match) {
      const normalizedTeam = match.teamAbbr ? normalizeEspnTeam(match.teamAbbr) : player.team;
      const espnTeam = VALID_NBA_TEAMS.has(normalizedTeam) ? normalizedTeam : player.team;
      return {
        sleeperId: player.sleeperId,
        espnAthleteId: match.id,
        name: player.name,
        espnTeam,
      };
    }
  }

  const searchUrl = `${ESPN_SEARCH_URL}?query=${encodeURIComponent(player.name)}&limit=10&type=player&sport=basketball&league=nba`;
  const searchRes = await fetchJsonSafe(searchUrl, fetchImpl);
  if (searchRes.ok) {
    const athletes = extractAthletesFromSearchPayload(searchRes.data);
    const candidates = athletes.filter(
      (a) => /^\d+$/.test(a.id) && !usedAthleteIds.has(a.id) && namesMatch(a.name, player.name),
    );
    const expectedTeam = normalizeEspnTeam(player.team);
    const match =
      candidates.find(
        (a) => a.teamAbbr !== undefined && normalizeEspnTeam(a.teamAbbr) === expectedTeam,
      ) ?? candidates[0];
    if (match) {
      const normalizedTeam = match.teamAbbr ? normalizeEspnTeam(match.teamAbbr) : player.team;
      const espnTeam = VALID_NBA_TEAMS.has(normalizedTeam) ? normalizedTeam : player.team;
      return {
        sleeperId: player.sleeperId,
        espnAthleteId: match.id,
        name: player.name,
        espnTeam,
      };
    }
  }

  throw new Error(
    `Could not resolve ESPN athlete ID for new player "${player.name}" (sleeperId: ${player.sleeperId}, team: ${player.team})`,
  );
}

export async function fetchWeekRemainingGames(
  startDate: string,
  endDate: string,
  rosteredPlayers: Player[],
  reserveIds: ReadonlySet<string>,
  gameLogs: GameLog[],
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string[]>> {
  const rosterTeams = new Set(rosteredPlayers.map((p) => p.team));
  const datesInWeek = listCalendarDates(startDate, endDate);

  const scheduledDatesByTeam = new Map<string, Set<string>>();
  for (const team of rosterTeams) {
    scheduledDatesByTeam.set(team, new Set());
  }

  for (const date of datesInWeek) {
    const compact = date.replace(/-/g, "");
    const url = `${ESPN_NBA_BASE_URL}/scoreboard?dates=${compact}`;
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(`GET ${url} failed: HTTP ${res.status}`);
    }
    const payload: unknown = await res.json();
    const games = extractEventsFromScoreboard(payload, rosterTeams, date);

    const finalTeamsOnDate = new Set<string>();
    const nonFinalTeamsOnDate = new Set<string>();
    for (const g of games) {
      if (g.isFinal) {
        finalTeamsOnDate.add(g.homeTeam);
        finalTeamsOnDate.add(g.awayTeam);
      } else {
        nonFinalTeamsOnDate.add(g.homeTeam);
        nonFinalTeamsOnDate.add(g.awayTeam);
      }
    }

    for (const team of nonFinalTeamsOnDate) {
      if (!finalTeamsOnDate.has(team)) {
        scheduledDatesByTeam.get(team)?.add(date);
      }
    }
  }

  const playerTeamMap = new Map(rosteredPlayers.map((p) => [p.sleeperId, p.team]));
  const loggedPlayerDates = new Set<string>();
  const loggedActiveTeamDates = new Set<string>();

  for (const log of gameLogs) {
    if (log.date < startDate || log.date > endDate) continue;
    loggedPlayerDates.add(`${log.sleeperId}|${log.date}`);
    const team = playerTeamMap.get(log.sleeperId);
    if (team && !reserveIds.has(log.sleeperId)) {
      loggedActiveTeamDates.add(`${team}|${log.date}`);
    }
  }

  const remainingGames: Record<string, string[]> = {};
  for (const player of rosteredPlayers) {
    const teamDates = scheduledDatesByTeam.get(player.team) ?? new Set<string>();
    const remaining = [...teamDates]
      .filter((d) => {
        if (loggedPlayerDates.has(`${player.sleeperId}|${d}`)) return false;
        if (loggedActiveTeamDates.has(`${player.team}|${d}`)) return false;
        return true;
      })
      .sort();
    remainingGames[player.sleeperId] = remaining;
  }

  return remainingGames;
}

function buildOpponentPlayers(
  matchups: unknown,
  leg: number,
  opponentRosterId: number,
  matchupId: number,
  sleeperPlayers: Record<string, SleeperPlayerMeta>,
): { opponentPoints: number; opponentPlayers: OpponentPlayerScore[] } {
  const live = parseLiveMatchup(matchups, leg, opponentRosterId, matchupId);
  const opponentPlayers: OpponentPlayerScore[] = live.opponentStarters.map((st) => {
    const meta = sleeperPlayers[st.sleeperId];
    const name =
      meta?.full_name?.trim() ||
      [meta?.first_name, meta?.last_name].filter(Boolean).join(" ").trim() ||
      `Player #${st.sleeperId}`;
    const position =
      meta?.position?.trim() ||
      (Array.isArray(meta?.fantasy_positions) && meta.fantasy_positions.length > 0
        ? meta.fantasy_positions.join("/")
        : undefined);
    const rawTeam = meta?.team ? normalizeEspnTeam(meta.team) : undefined;
    const team = rawTeam && VALID_NBA_TEAMS.has(rawTeam) ? rawTeam : undefined;

    return {
      sleeperId: st.sleeperId,
      name,
      ...(position ? { position } : {}),
      ...(team ? { team } : {}),
      points: round2(st.points),
    };
  });

  return {
    opponentPoints: round2(live.opponentPoints),
    opponentPlayers,
  };
}

function resolveOpponentInfo(
  rosters: SleeperRosterEntry[],
  users: SleeperUserEntry[],
  matchups: unknown,
  leg: number,
  targetRosterId: number,
  existingWeek: WeekRecord | undefined,
): {
  matchupId: number;
  opponentRosterId: number;
  opponentName: string;
} {
  if (!Array.isArray(matchups)) {
    throw new Error(`Sleeper matchups payload for leg ${leg} must be an array`);
  }
  const entries = matchups.filter(isRecord);
  const userEntry = entries.find((e) => e.roster_id === targetRosterId);
  if (!userEntry || typeof userEntry.matchup_id !== "number") {
    throw new Error(
      `Sleeper matchups payload for leg ${leg} is missing roster ${targetRosterId} matchup_id`,
    );
  }
  const matchupId = userEntry.matchup_id;
  const oppEntry = entries.find(
    (e) =>
      e.matchup_id === matchupId &&
      typeof e.roster_id === "number" &&
      e.roster_id !== targetRosterId,
  );
  if (!oppEntry || typeof oppEntry.roster_id !== "number") {
    throw new Error(
      `Sleeper matchups payload for leg ${leg} is missing opponent for matchup_id ${matchupId}`,
    );
  }
  const opponentRosterId = oppEntry.roster_id;
  const oppRoster = rosters.find((r) => r.roster_id === opponentRosterId);
  const oppUser = oppRoster?.owner_id
    ? users.find((u) => u.user_id === oppRoster.owner_id)
    : undefined;
  const opponentName =
    oppUser?.display_name?.trim() ||
    oppUser?.username?.trim() ||
    existingWeek?.opponentName ||
    `Roster ${opponentRosterId}`;

  return { matchupId, opponentRosterId, opponentName };
}

function areStringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function areRemainingGamesEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (!areStringArraysEqual(keysA, keysB)) return false;
  return keysA.every((k) => areStringArraysEqual(a[k] ?? [], b[k] ?? []));
}

function havePlayersChanged(next: Player[], prev: Player[]): boolean {
  if (next.length !== prev.length) return true;
  const prevById = new Map(prev.map((p) => [p.sleeperId, p]));
  for (const p of next) {
    const old = prevById.get(p.sleeperId);
    if (!old) return true;
    if (
      old.name !== p.name ||
      old.team !== p.team ||
      old.rosterStatus !== p.rosterStatus ||
      !areStringArraysEqual(old.positions, p.positions)
    ) {
      return true;
    }
  }
  return false;
}

function haveMapEntriesChanged(
  next: EspnPlayerMapEntry[],
  prev: EspnPlayerMapEntry[],
): boolean {
  if (next.length !== prev.length) return true;
  const prevById = new Map(prev.map((e) => [e.sleeperId, e]));
  for (const e of next) {
    const old = prevById.get(e.sleeperId);
    if (!old) return true;
    if (
      old.espnAthleteId !== e.espnAthleteId ||
      old.name !== e.name ||
      old.espnTeam !== e.espnTeam
    ) {
      return true;
    }
  }
  return false;
}

function hasWeekContentChanged(
  next: Omit<WeekRecord, "opponentAsOf">,
  existing: WeekRecord,
): boolean {
  return (
    next.leg !== existing.leg ||
    next.startDate !== existing.startDate ||
    next.endDate !== existing.endDate ||
    next.matchupId !== existing.matchupId ||
    next.opponentRosterId !== existing.opponentRosterId ||
    next.opponentName !== existing.opponentName ||
    next.opponentPoints !== existing.opponentPoints ||
    JSON.stringify(next.opponentPlayers ?? []) !==
      JSON.stringify(existing.opponentPlayers ?? []) ||
    !areStringArraysEqual(next.starters, existing.starters) ||
    !areStringArraysEqual(next.bench, existing.bench) ||
    !areStringArraysEqual(next.reserve, existing.reserve) ||
    !areRemainingGamesEqual(next.remainingGames, existing.remainingGames)
  );
}

export async function applySleeperSync(input: SyncApplyInput): Promise<SyncApplyResult> {
  const targetRosterId = input.targetRosterId ?? 1;
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const targetLeg = input.state.leg ?? input.state.week ?? 1;

  const report = buildSyncReport({
    state: input.state,
    rosters: input.rosters,
    transactions: input.transactions,
    matchups: input.matchups,
    sleeperPlayers: input.sleeperPlayers,
    playersFile: input.playersFile,
    weeksFile: input.weeksFile,
    gameLogs: input.gameLogs,
    targetRosterId,
  });

  const roster = input.rosters.find((r) => r.roster_id === targetRosterId);
  if (!roster) {
    throw new Error(`Sleeper rosters payload is missing roster_id ${targetRosterId}`);
  }

  const starters = (roster.starters ?? []).filter(
    (id): id is string => typeof id === "string" && id !== "" && id !== "0",
  );
  if (starters.length !== STARTER_SLOTS.length) {
    throw new Error(
      `Sleeper roster ${targetRosterId} must have ${STARTER_SLOTS.length} starters, got ${starters.length}`,
    );
  }
  const starterSet = new Set(starters);
  if (starterSet.size !== STARTER_SLOTS.length) {
    throw new Error(`Sleeper roster ${targetRosterId} has duplicate starter IDs`);
  }

  const reserve = [
    ...new Set(
      (roster.reserve ?? []).filter(
        (id): id is string =>
          typeof id === "string" && id !== "" && id !== "0" && !starterSet.has(id),
      ),
    ),
  ];
  if (reserve.length > 2) {
    throw new Error(`Sleeper roster ${targetRosterId} has ${reserve.length} reserve players (max 2)`);
  }
  const reserveSet = new Set(reserve);

  const bench = [
    ...new Set(
      (roster.players ?? []).filter(
        (id): id is string =>
          typeof id === "string" &&
          id !== "" &&
          id !== "0" &&
          !starterSet.has(id) &&
          !reserveSet.has(id),
      ),
    ),
  ];
  if (bench.length > 6) {
    throw new Error(`Sleeper roster ${targetRosterId} has ${bench.length} bench players (max 6)`);
  }

  const activeSleeperIds = [...starters, ...bench, ...reserve];
  const activeSleeperSet = new Set(activeSleeperIds);

  const getSlotStatus = (id: string): RosterStatus => {
    if (starterSet.has(id)) return "starter";
    if (reserveSet.has(id)) return "reserve";
    return "bench";
  };

  const existingPlayersById = new Map(
    input.playersFile.players.map((p) => [p.sleeperId, p]),
  );
  const loggedPlayerIds = new Set(input.gameLogs.map((l) => l.sleeperId));

  const nextPlayers: Player[] = [];
  const addedPlayers: Player[] = [];
  const retainedDroppedPlayers: Player[] = [];
  const removedDroppedPlayerIds: string[] = [];

  for (const id of activeSleeperIds) {
    const existing = existingPlayersById.get(id);
    const meta = input.sleeperPlayers[id];
    const rosterStatus = getSlotStatus(id);

    if (existing) {
      const team = meta?.team ? resolveSleeperTeam(id, meta, existing) : existing.team;
      const positions = meta ? resolveSleeperPositions(id, meta, existing) : [...existing.positions];
      nextPlayers.push({
        sleeperId: existing.sleeperId,
        name: existing.name,
        team,
        positions,
        rosterStatus,
      });
    } else {
      const newPlayer: Player = {
        sleeperId: id,
        name: resolveSleeperName(id, meta),
        team: resolveSleeperTeam(id, meta),
        positions: resolveSleeperPositions(id, meta),
        rosterStatus,
      };
      nextPlayers.push(newPlayer);
      addedPlayers.push(newPlayer);
    }
  }

  // Validate starter slot eligibility
  const nextPlayersById = new Map(nextPlayers.map((p) => [p.sleeperId, p]));
  starters.forEach((id, idx) => {
    const player = nextPlayersById.get(id)!;
    const slot = STARTER_SLOTS[idx]!;
    if (!isPositionEligibleForSlot(player.positions, slot)) {
      throw new Error(
        `Starter "${id}" (${player.name}, [${player.positions.join(",")}]) is ineligible for slot ${slot} at index ${idx}`,
      );
    }
  });

  // Handle dropped players: retain if they have game logs, remove otherwise
  for (const existing of input.playersFile.players) {
    if (activeSleeperSet.has(existing.sleeperId)) continue;
    if (loggedPlayerIds.has(existing.sleeperId)) {
      const retained: Player = {
        ...existing,
        positions: [...existing.positions],
        rosterStatus: "reserve",
      };
      nextPlayers.push(retained);
      retainedDroppedPlayers.push(retained);
    } else {
      removedDroppedPlayerIds.push(existing.sleeperId);
    }
  }

  const playersChanged = havePlayersChanged(nextPlayers, input.playersFile.players);
  const todayEastern = computeEasternDateWindow(now).today;
  const nextAsOf =
    playersChanged && todayEastern > input.playersFile.asOf
      ? todayEastern
      : input.playersFile.asOf;

  const updatedPlayers: PlayersFile = playersChanged
    ? {
        asOf: nextAsOf,
        leagueId: LEAGUE_ID,
        players: nextPlayers,
      }
    : structuredClone(input.playersFile);

  // Update EspnPlayerMapFile: keep entries for players in nextPlayers, resolve missing
  const existingMapBySleeperId = new Map(
    input.espnPlayerMapFile.players.map((e) => [e.sleeperId, e]),
  );
  const usedAthleteIds = new Set<string>();
  const nextMapEntries: EspnPlayerMapEntry[] = [];

  for (const p of nextPlayers) {
    const existingEntry = existingMapBySleeperId.get(p.sleeperId);
    if (existingEntry) {
      usedAthleteIds.add(existingEntry.espnAthleteId);
    }
  }

  for (const p of nextPlayers) {
    const existingEntry = existingMapBySleeperId.get(p.sleeperId);
    if (existingEntry) {
      nextMapEntries.push({
        ...existingEntry,
        espnTeam: p.team,
      });
    } else {
      const resolved = await resolveEspnAthleteForPlayer(p, usedAthleteIds, fetchImpl);
      usedAthleteIds.add(resolved.espnAthleteId);
      nextMapEntries.push(resolved);
    }
  }

  const mapChanged = haveMapEntriesChanged(nextMapEntries, input.espnPlayerMapFile.players);
  const updatedEspnPlayerMap: EspnPlayerMapFile = mapChanged
    ? {
        leagueId: LEAGUE_ID,
        players: nextMapEntries,
      }
    : structuredClone(input.espnPlayerMapFile);

  // Update or create active WeekRecord
  const existingWeek = input.weeksFile.weeks.find((w) => w.leg === targetLeg);
  const createdNewLeg = existingWeek === undefined;
  const { startDate, endDate } = deriveLegDates(targetLeg, input.weeksFile, input.state);
  const { matchupId, opponentRosterId, opponentName } = resolveOpponentInfo(
    input.rosters,
    input.users,
    input.matchups,
    targetLeg,
    targetRosterId,
    existingWeek,
  );
  const { opponentPoints, opponentPlayers } = buildOpponentPlayers(
    input.matchups,
    targetLeg,
    opponentRosterId,
    matchupId,
    input.sleeperPlayers,
  );

  const activeRosterPlayers = activeSleeperIds.map((id) => nextPlayersById.get(id)!);
  const remainingGames = await fetchWeekRemainingGames(
    startDate,
    endDate,
    activeRosterPlayers,
    reserveSet,
    input.gameLogs,
    fetchImpl,
  );

  const candidateWeekFields: Omit<WeekRecord, "opponentAsOf"> = {
    leg: targetLeg,
    startDate,
    endDate,
    matchupId,
    opponentRosterId,
    opponentName,
    opponentPoints,
    ...(existingWeek?.opponentRemainingGames !== undefined
      ? { opponentRemainingGames: existingWeek.opponentRemainingGames }
      : {}),
    opponentPlayers,
    starters,
    bench,
    reserve,
    remainingGames,
  };

  const weeksChanged =
    createdNewLeg || hasWeekContentChanged(candidateWeekFields, existingWeek);

  const updatedWeekRecord: WeekRecord = weeksChanged
    ? {
        ...candidateWeekFields,
        opponentAsOf: now.toISOString(),
      }
    : structuredClone(existingWeek);

  const nextWeeksList = weeksChanged
    ? (() => {
        const list = input.weeksFile.weeks.map((w) =>
          w.leg === targetLeg ? updatedWeekRecord : structuredClone(w),
        );
        if (createdNewLeg) {
          list.push(updatedWeekRecord);
        }
        list.sort((a, b) => a.leg - b.leg);
        return list;
      })()
    : structuredClone(input.weeksFile.weeks);

  const updatedWeeks: WeeksFile = {
    leagueId: LEAGUE_ID,
    weeks: nextWeeksList,
  };

  const changed = playersChanged || weeksChanged || mapChanged;

  const prMetadata = buildSyncPrMetadata({
    leg: targetLeg,
    changed,
    hasActionableDiffs: report.hasActionableDiffs,
    createdNewLeg,
    addedPlayers,
    retainedDroppedPlayers,
    removedDroppedPlayerIds,
    report,
  });

  return {
    updatedPlayers,
    updatedWeeks,
    updatedEspnPlayerMap,
    report,
    prMetadata,
    addedPlayers,
    retainedDroppedPlayers,
    removedDroppedPlayerIds,
    createdNewLeg,
    playersChanged,
    weeksChanged,
    mapChanged,
    changed,
  };
}

export function buildSyncPrMetadata(params: {
  leg: number;
  changed: boolean;
  hasActionableDiffs: boolean;
  createdNewLeg: boolean;
  addedPlayers: Player[];
  retainedDroppedPlayers: Player[];
  removedDroppedPlayerIds: string[];
  report: SyncReportResult;
}): SyncPrMetadata {
  const branchName = `sync/sleeper-leg-${params.leg}`;
  const title = params.createdNewLeg
    ? `data: sync Sleeper leg ${params.leg} & roster`
    : `data: sync Sleeper roster (leg ${params.leg})`;

  const lines: string[] = [];
  lines.push(`## Sleeper Roster & Week Sync (Leg ${params.leg})`);
  lines.push("");
  lines.push(`- **New leg created:** ${params.createdNewLeg ? "yes" : "no"}`);
  lines.push(`- **Players added:** ${params.addedPlayers.length}`);
  if (params.addedPlayers.length > 0) {
    for (const p of params.addedPlayers) {
      lines.push(`  - + ${p.name} (\`${p.sleeperId}\`, ${p.positions.join("/")} · ${p.team}, ${p.rosterStatus})`);
    }
  }
  lines.push(`- **Dropped players retained (with game logs):** ${params.retainedDroppedPlayers.length}`);
  if (params.retainedDroppedPlayers.length > 0) {
    for (const p of params.retainedDroppedPlayers) {
      lines.push(`  - ~ ${p.name} (\`${p.sleeperId}\`, ${p.team}) — retained as \`reserve\` in players.json`);
    }
  }
  lines.push(`- **Dropped players removed (no game logs):** ${params.removedDroppedPlayerIds.length}`);
  lines.push("");
  lines.push("<details>");
  lines.push("<summary>Sleeper Sync Diff Report</summary>");
  lines.push("");
  lines.push("```text");
  lines.push(params.report.textReport);
  lines.push("```");
  lines.push("</details>");

  return {
    changed: params.changed,
    hasActionableDiffs: params.hasActionableDiffs,
    leg: params.leg,
    branchName,
    title,
    body: lines.join("\n"),
  };
}

const SLEEPER_BASE_URL = "https://api.sleeper.app/v1";

export interface RunSleeperSyncApplyOptions {
  playersPath: string;
  weeksPath: string;
  logsPath: string;
  espnMapPath: string;
  applyToData: boolean;
  targetRosterId?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
}

async function fetchSleeperJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function runSleeperSyncApply(
  options: RunSleeperSyncApplyOptions,
): Promise<SyncApplyResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const playersFile = loadPlayers(options.playersPath);
  const weeksFile = loadWeeks(options.weeksPath);
  const gameLogs = loadGameLogs(options.logsPath);
  const espnPlayerMapFile = loadEspnPlayerMap(options.espnMapPath);

  const state = await fetchSleeperJson<SleeperNbaState>(
    `${SLEEPER_BASE_URL}/state/nba`,
    fetchImpl,
  );
  const leg = state.leg ?? state.week ?? 1;

  const [rosters, users, transactions, matchups, sleeperPlayers] = await Promise.all([
    fetchSleeperJson<SleeperRosterEntry[]>(
      `${SLEEPER_BASE_URL}/league/${LEAGUE_ID}/rosters`,
      fetchImpl,
    ),
    fetchSleeperJson<SleeperUserEntry[]>(
      `${SLEEPER_BASE_URL}/league/${LEAGUE_ID}/users`,
      fetchImpl,
    ),
    fetchSleeperJson<SleeperTransactionEntry[]>(
      `${SLEEPER_BASE_URL}/league/${LEAGUE_ID}/transactions/${leg}`,
      fetchImpl,
    ),
    fetchSleeperJson<unknown>(
      `${SLEEPER_BASE_URL}/league/${LEAGUE_ID}/matchups/${leg}`,
      fetchImpl,
    ),
    fetchSleeperJson<Record<string, SleeperPlayerMeta>>(
      `${SLEEPER_BASE_URL}/players/nba`,
      fetchImpl,
    ),
  ]);

  const result = await applySleeperSync({
    state,
    rosters,
    users,
    transactions,
    matchups,
    sleeperPlayers,
    playersFile,
    weeksFile,
    espnPlayerMapFile,
    gameLogs,
    ...(options.targetRosterId !== undefined ? { targetRosterId: options.targetRosterId } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    fetchImpl,
  });

  if (options.applyToData && result.changed) {
    writeFileSync(options.playersPath, `${JSON.stringify(result.updatedPlayers, null, 2)}\n`, "utf-8");
    writeFileSync(options.weeksPath, `${JSON.stringify(result.updatedWeeks, null, 2)}\n`, "utf-8");
    writeFileSync(
      options.espnMapPath,
      `${JSON.stringify(result.updatedEspnPlayerMap, null, 2)}\n`,
      "utf-8",
    );
  }

  return result;
}
