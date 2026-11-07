// Stage 5b — Read-Only Roster & Week Sync Diff Engine (`docs/design/NETRICS-DESIGN.md` §8.3).
// Compares live Sleeper endpoints (`state/nba`, `rosters`, `transactions/{leg}`,
// `matchups/{leg}`, `players/nba`) against local `data/players.json` and `data/weeks.json`.
// Never modifies files; returns structured diff + human-readable report.

import type { PlayersFile, RosterStatus, WeeksFile } from "../data/types.js";
import { round2 } from "../scoring/index.js";
import { parseLiveMatchup } from "./liveMatchup.js";

export interface SleeperNbaState {
  leg?: number;
  week?: number;
  season?: string;
}

export interface SleeperRosterEntry {
  roster_id: number;
  players?: string[] | null;
  starters?: string[] | null;
  reserve?: string[] | null;
}

export interface SleeperTransactionEntry {
  type?: string;
  status?: string;
  status_updated?: number;
  created?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
}

export interface SleeperPlayerMeta {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
}

export interface MissingPlayerDiff {
  sleeperId: string;
  name: string;
  team: string;
  position: string;
  sleeperSlot: RosterStatus;
}

export interface DroppedPlayerDiff {
  sleeperId: string;
  name: string;
  team: string;
  localStatus: RosterStatus;
  source: "players.json" | "weeks.json" | "both";
}

export interface SlotMismatchDiff {
  sleeperId: string;
  name: string;
  sleeperSlot: RosterStatus;
  playersJsonStatus?: RosterStatus;
  weekStatus?: RosterStatus;
}

export interface FormattedTransaction {
  type: string;
  date: string;
  added: string[];
  dropped: string[];
}

export interface SyncReportInput {
  state: SleeperNbaState;
  rosters: SleeperRosterEntry[];
  transactions: SleeperTransactionEntry[];
  matchups: unknown;
  sleeperPlayers?: Record<string, SleeperPlayerMeta>;
  playersFile: PlayersFile;
  weeksFile: WeeksFile;
  targetRosterId?: number;
}

export interface SyncReportResult {
  hasActionableDiffs: boolean;
  legDiff: {
    sleeperLeg: number;
    latestLocalLeg: number | null;
    missingCurrentLeg: boolean;
  };
  rosterDiffs: {
    missingFromLocal: MissingPlayerDiff[];
    droppedFromSleeper: DroppedPlayerDiff[];
    slotMismatches: SlotMismatchDiff[];
  };
  transactions: FormattedTransaction[];
  matchupDiff: {
    leg: number;
    storedOpponentPoints: number;
    liveOpponentPoints: number;
    opponentDelta: number;
    liveUserPoints: number;
    opponentStarters: {
      sleeperId: string;
      name: string;
      position: string;
      team: string;
      points: number;
    }[];
  } | null;
  textReport: string;
}

function resolvePlayerMeta(
  sleeperId: string,
  sleeperPlayers: Record<string, SleeperPlayerMeta> | undefined,
  localPlayersMap: Map<string, { name: string; team: string; positions: string[] }>,
): { name: string; team: string; position: string } {
  const local = localPlayersMap.get(sleeperId);
  if (local) {
    return {
      name: local.name,
      team: local.team,
      position: local.positions.join("/") || "?",
    };
  }
  const sp = sleeperPlayers?.[sleeperId];
  const fullName =
    sp?.full_name?.trim() ||
    [sp?.first_name, sp?.last_name].filter(Boolean).join(" ").trim() ||
    `Player #${sleeperId}`;
  const team = sp?.team ?? "FA";
  const pos =
    sp?.position ||
    (Array.isArray(sp?.fantasy_positions) ? sp.fantasy_positions.join("/") : "") ||
    "?";
  return { name: fullName, team, position: pos };
}

export function buildSyncReport(input: SyncReportInput): SyncReportResult {
  const targetRosterId = input.targetRosterId ?? 1;
  const sleeperLeg = input.state.leg ?? input.state.week ?? 0;

  const sortedWeeks = [...input.weeksFile.weeks].sort((a, b) => b.leg - a.leg);
  const latestWeek = sortedWeeks[0] ?? null;
  const latestLocalLeg = latestWeek ? latestWeek.leg : null;
  const matchingWeek = input.weeksFile.weeks.find((w) => w.leg === sleeperLeg) ?? latestWeek;
  const missingCurrentLeg =
    sleeperLeg > 0 && !input.weeksFile.weeks.some((w) => w.leg === sleeperLeg);

  const roster = input.rosters.find((r) => r.roster_id === targetRosterId);
  if (!roster) {
    throw new Error(`Sleeper rosters payload is missing roster_id ${targetRosterId}`);
  }

  const sleeperStarters = new Set(
    (roster.starters ?? []).filter((id): id is string => typeof id === "string" && id !== "" && id !== "0"),
  );
  const sleeperReserve = new Set(
    (roster.reserve ?? []).filter((id): id is string => typeof id === "string" && id !== "" && id !== "0"),
  );
  const sleeperAllPlayers = new Set(
    (roster.players ?? []).filter((id): id is string => typeof id === "string" && id !== "" && id !== "0"),
  );
  for (const id of sleeperStarters) sleeperAllPlayers.add(id);
  for (const id of sleeperReserve) sleeperAllPlayers.add(id);

  const getSleeperSlot = (id: string): RosterStatus => {
    if (sleeperStarters.has(id)) return "starter";
    if (sleeperReserve.has(id)) return "reserve";
    return "bench";
  };

  const localPlayersMap = new Map(
    input.playersFile.players.map((p) => [p.sleeperId, p]),
  );

  const weekSlotMap = new Map<string, RosterStatus>();
  if (matchingWeek) {
    for (const id of matchingWeek.starters) weekSlotMap.set(id, "starter");
    for (const id of matchingWeek.bench) weekSlotMap.set(id, "bench");
    for (const id of matchingWeek.reserve) weekSlotMap.set(id, "reserve");
  }

  const missingFromLocal: MissingPlayerDiff[] = [];
  const droppedFromSleeper: DroppedPlayerDiff[] = [];
  const slotMismatches: SlotMismatchDiff[] = [];

  for (const id of sleeperAllPlayers) {
    const sleeperSlot = getSleeperSlot(id);
    const localPlayer = localPlayersMap.get(id);
    const weekSlot = weekSlotMap.get(id);

    if (!localPlayer) {
      const meta = resolvePlayerMeta(id, input.sleeperPlayers, localPlayersMap);
      missingFromLocal.push({
        sleeperId: id,
        name: meta.name,
        team: meta.team,
        position: meta.position,
        sleeperSlot,
      });
      continue;
    }

    const playersJsonMismatch = localPlayer.rosterStatus !== sleeperSlot;
    const weekMismatch = matchingWeek !== null && weekSlot !== sleeperSlot;
    if (playersJsonMismatch || weekMismatch) {
      slotMismatches.push({
        sleeperId: id,
        name: localPlayer.name,
        sleeperSlot,
        ...(localPlayer.rosterStatus ? { playersJsonStatus: localPlayer.rosterStatus } : {}),
        ...(weekSlot ? { weekStatus: weekSlot } : {}),
      });
    }
  }

  const allLocalIds = new Set<string>([
    ...localPlayersMap.keys(),
    ...weekSlotMap.keys(),
  ]);

  for (const id of allLocalIds) {
    if (!sleeperAllPlayers.has(id)) {
      const inPlayers = localPlayersMap.has(id);
      const inWeek = weekSlotMap.has(id);
      const meta = resolvePlayerMeta(id, input.sleeperPlayers, localPlayersMap);
      const localStatus =
        localPlayersMap.get(id)?.rosterStatus ?? weekSlotMap.get(id) ?? "bench";
      droppedFromSleeper.push({
        sleeperId: id,
        name: meta.name,
        team: meta.team,
        localStatus,
        source: inPlayers && inWeek ? "both" : inPlayers ? "players.json" : "weeks.json",
      });
    }
  }

  // Transactions for Roster 1
  const formattedTransactions: FormattedTransaction[] = [];
  for (const tx of input.transactions ?? []) {
    if (tx.status && tx.status !== "complete") continue;
    const addsForRoster = Object.entries(tx.adds ?? {})
      .filter(([, rId]) => rId === targetRosterId)
      .map(([pId]) => {
        const m = resolvePlayerMeta(pId, input.sleeperPlayers, localPlayersMap);
        return `${m.name} (${pId}, ${m.team})`;
      });
    const dropsForRoster = Object.entries(tx.drops ?? {})
      .filter(([, rId]) => rId === targetRosterId)
      .map(([pId]) => {
        const m = resolvePlayerMeta(pId, input.sleeperPlayers, localPlayersMap);
        return `${m.name} (${pId}, ${m.team})`;
      });

    if (addsForRoster.length === 0 && dropsForRoster.length === 0) continue;

    const ts = tx.status_updated ?? tx.created ?? 0;
    const date = ts > 0 ? new Date(ts).toISOString().slice(0, 10) : "unknown-date";
    formattedTransactions.push({
      type: tx.type ?? "transaction",
      date,
      added: addsForRoster,
      dropped: dropsForRoster,
    });
  }

  // Matchup snapshot comparison (informational)
  let matchupDiff: SyncReportResult["matchupDiff"] = null;
  if (matchingWeek && Array.isArray(input.matchups)) {
    try {
      const live = parseLiveMatchup(
        input.matchups,
        matchingWeek.leg,
        matchingWeek.opponentRosterId,
        matchingWeek.matchupId,
      );
      const opponentStarters = live.opponentStarters.map((st) => {
        const meta = resolvePlayerMeta(st.sleeperId, input.sleeperPlayers, localPlayersMap);
        return {
          sleeperId: st.sleeperId,
          name: meta.name,
          position: meta.position,
          team: meta.team,
          points: st.points,
        };
      });
      matchupDiff = {
        leg: matchingWeek.leg,
        storedOpponentPoints: round2(matchingWeek.opponentPoints),
        liveOpponentPoints: live.opponentPoints,
        opponentDelta: round2(live.opponentPoints - matchingWeek.opponentPoints),
        liveUserPoints: live.userPoints,
        opponentStarters,
      };
    } catch {
      matchupDiff = null;
    }
  }

  const hasActionableDiffs =
    missingCurrentLeg ||
    missingFromLocal.length > 0 ||
    droppedFromSleeper.length > 0 ||
    slotMismatches.length > 0;

  const lines: string[] = [];
  lines.push(`=== Netrics Sleeper Sync Report (Read-Only) ===`);
  lines.push(
    `Leg Check: Sleeper current leg = ${sleeperLeg}, local latest leg = ${latestLocalLeg ?? "none"} -> ${
      missingCurrentLeg ? "ACTION NEEDED (missing current leg in weeks.json)" : "OK"
    }`,
  );

  lines.push(
    `Roster #${targetRosterId} Membership: ${sleeperAllPlayers.size} on Sleeper vs ${input.playersFile.players.length} in players.json (asOf ${input.playersFile.asOf})`,
  );

  if (missingFromLocal.length === 0 && droppedFromSleeper.length === 0 && slotMismatches.length === 0) {
    lines.push(`  - Roster & slots: IN SYNC`);
  } else {
    for (const m of missingFromLocal) {
      lines.push(
        `  - MISSING FROM LOCAL: ${m.name} (${m.sleeperId}, ${m.position} · ${m.team}) — on Sleeper as ${m.sleeperSlot}`,
      );
    }
    for (const d of droppedFromSleeper) {
      lines.push(
        `  - DROPPED FROM SLEEPER: ${d.name} (${d.sleeperId}, ${d.team}) — still in ${d.source} as ${d.localStatus}`,
      );
    }
    for (const s of slotMismatches) {
      lines.push(
        `  - SLOT MISMATCH: ${s.name} (${s.sleeperId}) — Sleeper: ${s.sleeperSlot}, players.json: ${s.playersJsonStatus ?? "missing"}, weeks.json: ${s.weekStatus ?? "missing"}`,
      );
    }
  }

  if (formattedTransactions.length > 0) {
    lines.push(`Roster #${targetRosterId} Transactions (Leg ${sleeperLeg}):`);
    for (const t of formattedTransactions) {
      const parts: string[] = [];
      if (t.added.length > 0) parts.push(`+Added: ${t.added.join(", ")}`);
      if (t.dropped.length > 0) parts.push(`-Dropped: ${t.dropped.join(", ")}`);
      lines.push(`  - [${t.date}] (${t.type}) ${parts.join(" | ")}`);
    }
  }

  if (matchupDiff) {
    lines.push(
      `Matchup Snapshot (Leg ${matchupDiff.leg}, informational): stored opponent = ${matchupDiff.storedOpponentPoints.toFixed(2)}, live opponent = ${matchupDiff.liveOpponentPoints.toFixed(2)} (delta ${matchupDiff.opponentDelta >= 0 ? "+" : ""}${matchupDiff.opponentDelta.toFixed(2)}), live user = ${matchupDiff.liveUserPoints.toFixed(2)}`,
    );
    if (matchupDiff.opponentStarters.length > 0) {
      lines.push(
        `  - Opponent Starters: ${matchupDiff.opponentStarters
          .map((s) => `${s.name} (${s.sleeperId}, ${s.position}·${s.team}): ${s.points.toFixed(2)}`)
          .join(", ")}`,
      );
    }
  }

  lines.push(`Status: ${hasActionableDiffs ? "OUT OF SYNC (exit 1)" : "IN SYNC (exit 0)"}`);

  return {
    hasActionableDiffs,
    legDiff: {
      sleeperLeg,
      latestLocalLeg,
      missingCurrentLeg,
    },
    rosterDiffs: {
      missingFromLocal,
      droppedFromSleeper,
      slotMismatches,
    },
    transactions: formattedTransactions,
    matchupDiff,
    textReport: lines.join("\n"),
  };
}
