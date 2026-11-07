// Stage 5a — Runtime Live Matchup fetcher & parser (`docs/design/NETRICS-DESIGN.md` §8.2).
// Fetches `GET /v1/league/{leagueId}/matchups/{leg}`, validates the response,
// and guards repeated requests per `(leagueId, leg, opponentRosterId)` with a
// 15-second cooldown (`LIVE_MATCHUP_COOLDOWN_MS = 15_000`).
// Live Sleeper data is display-only and never mutates `locks.json` or advisor inputs.

import { round2 } from "../scoring/index.js";

export const LIVE_MATCHUP_COOLDOWN_MS = 15_000;

export interface LiveStarterScore {
  sleeperId: string;
  points: number;
}

export interface LiveMatchup {
  leg: number;
  matchupId: number;
  fetchedAt: string;
  userPoints: number;
  opponentRosterId: number;
  opponentPoints: number;
  opponentStarters: LiveStarterScore[];
  userStarters: LiveStarterScore[];
}

interface RawMatchupEntry {
  roster_id?: unknown;
  matchup_id?: unknown;
  points?: unknown;
  starters?: unknown;
  starters_points?: unknown;
  players_points?: unknown;
}

interface CacheRecord {
  data: LiveMatchup;
  timestampMs: number;
}

const liveMatchupCache = new Map<string, CacheRecord>();

export function resetLiveMatchupCache(): void {
  liveMatchupCache.clear();
}

function extractStarterScores(entry: RawMatchupEntry, label: string): LiveStarterScore[] {
  if (!Array.isArray(entry.starters)) {
    return [];
  }
  const playersPoints =
    typeof entry.players_points === "object" &&
    entry.players_points !== null &&
    !Array.isArray(entry.players_points)
      ? (entry.players_points as Record<string, unknown>)
      : {};
  const startersPoints = Array.isArray(entry.starters_points) ? entry.starters_points : [];

  const result: LiveStarterScore[] = [];
  entry.starters.forEach((rawId, idx) => {
    if (typeof rawId !== "string" || rawId.trim() === "" || rawId === "0") {
      return;
    }
    const fromPlayers = playersPoints[rawId];
    const fromStarters = startersPoints[idx];
    const rawPts = fromPlayers !== undefined ? fromPlayers : fromStarters !== undefined ? fromStarters : 0;
    if (typeof rawPts !== "number" || !Number.isFinite(rawPts)) {
      throw new Error(
        `Invalid starter points for ${label} starter "${rawId}" at index ${idx}: ${JSON.stringify(rawPts)}`,
      );
    }
    result.push({
      sleeperId: rawId,
      points: round2(rawPts),
    });
  });

  return result;
}

export function parseLiveMatchup(
  payload: unknown,
  leg: number,
  opponentRosterId: number,
  matchupId?: number,
  fetchedAt?: string,
): LiveMatchup {
  if (!Array.isArray(payload)) {
    throw new Error("Sleeper matchups payload must be a JSON array");
  }

  const entries = payload.filter(
    (item): item is RawMatchupEntry => typeof item === "object" && item !== null,
  );

  const userEntry = entries.find((e) => e.roster_id === 1);
  if (!userEntry) {
    throw new Error("Sleeper matchups payload is missing user entry (roster_id: 1)");
  }

  const oppEntry = entries.find((e) => e.roster_id === opponentRosterId);
  if (!oppEntry) {
    throw new Error(
      `Sleeper matchups payload is missing opponent entry (roster_id: ${opponentRosterId})`,
    );
  }

  if (typeof userEntry.matchup_id !== "number" || !Number.isInteger(userEntry.matchup_id)) {
    throw new Error(
      `Invalid matchup_id on user entry (roster_id: 1): ${JSON.stringify(userEntry.matchup_id)}`,
    );
  }

  if (typeof oppEntry.matchup_id !== "number" || !Number.isInteger(oppEntry.matchup_id)) {
    throw new Error(
      `Invalid matchup_id on opponent entry (roster_id: ${opponentRosterId}): ${JSON.stringify(oppEntry.matchup_id)}`,
    );
  }

  if (userEntry.matchup_id !== oppEntry.matchup_id) {
    throw new Error(
      `Matchup ID mismatch between roster 1 (${userEntry.matchup_id}) and opponent roster ${opponentRosterId} (${oppEntry.matchup_id})`,
    );
  }

  if (matchupId !== undefined && userEntry.matchup_id !== matchupId) {
    throw new Error(
      `Expected matchup_id ${matchupId} for leg ${leg}, got ${userEntry.matchup_id}`,
    );
  }

  if (typeof userEntry.points !== "number" || !Number.isFinite(userEntry.points)) {
    throw new Error(
      `Invalid points on user entry (roster_id: 1): ${JSON.stringify(userEntry.points)}`,
    );
  }

  if (typeof oppEntry.points !== "number" || !Number.isFinite(oppEntry.points)) {
    throw new Error(
      `Invalid points on opponent entry (roster_id: ${opponentRosterId}): ${JSON.stringify(oppEntry.points)}`,
    );
  }

  return {
    leg,
    matchupId: userEntry.matchup_id,
    fetchedAt: fetchedAt ?? new Date().toISOString(),
    userPoints: round2(userEntry.points),
    opponentRosterId,
    opponentPoints: round2(oppEntry.points),
    opponentStarters: extractStarterScores(oppEntry, `roster ${opponentRosterId}`),
    userStarters: extractStarterScores(userEntry, "roster 1"),
  };
}

export async function fetchLiveMatchup(
  leagueId: string,
  leg: number,
  opponentRosterId: number,
  matchupId?: number,
  options?: { force?: boolean; fetchImpl?: typeof fetch; now?: () => number },
): Promise<LiveMatchup> {
  const nowFn = options?.now ?? Date.now;
  const nowMs = nowFn();
  const cacheKey = `${leagueId}:${leg}:${opponentRosterId}`;

  if (!options?.force) {
    const cached = liveMatchupCache.get(cacheKey);
    if (cached && nowMs - cached.timestampMs < LIVE_MATCHUP_COOLDOWN_MS) {
      return cached.data;
    }
  }

  const fetchFn = options?.fetchImpl ?? fetch;
  const url = `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/matchups/${encodeURIComponent(String(leg))}`;
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Sleeper matchups request failed: HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  const fetchedAt = new Date(nowMs).toISOString();
  const parsed = parseLiveMatchup(payload, leg, opponentRosterId, matchupId, fetchedAt);

  liveMatchupCache.set(cacheKey, { data: parsed, timestampMs: nowMs });
  return parsed;
}
