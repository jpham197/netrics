// Pure export & share helpers for Netrics UI (ADR-0008).
// Never reads GameLog.expectedTotal.
// `mean` may appear ONLY in formatPlayerSummary labelled "Mean (ref only)".

import type {
  BenchSwingRecommendation,
  LockDecisionEvaluation,
  MatchupEvaluation,
  StarterAdvisorRow,
} from "../advisor/index.js";
import type { PlayerAnalytics, ScoredGame } from "../analytics/index.js";
import type { GameLog, Player, WeekRecord } from "../data/types.js";
import { fantasyPoints } from "../scoring/index.js";
import { fmt, fmtPct, fmtShortDate, fmtSigned } from "./format.js";

function fmtSignedEv(n: number): string {
  if (n > 0) return `+${n.toFixed(2)}`;
  if (n < 0) return `-${Math.abs(n).toFixed(2)}`;
  return "0.00";
}

function advisorStatusLabel(ev: LockDecisionEvaluation): string {
  if (ev.status === "LOCKED") return "LOCKED";
  if (ev.status === "NO_GAMES_LEFT") return "FINAL";
  if (ev.status === "NO_BANKED_SCORE") return "NO BANKED";
  if (ev.recommendation === "LEAN_RIDE") return "LEAN RIDE";
  return ev.recommendation ?? "—";
}

/**
 * Formats a shareable plain-text summary of the Lock Advisor view.
 * Never includes `mean` or reads `expectedTotal`.
 */
export function formatLockAdvisorSummary(
  week: WeekRecord,
  rows: StarterAdvisorRow[],
  matchup: MatchupEvaluation,
): string {
  const marginSign = matchup.margin >= 0 ? "+" : "-";
  const lines: string[] = [
    `Lock Advisor — Leg ${week.leg} (${week.startDate} to ${week.endDate})`,
    `Matchup: Beltline Ballers ${fmt(matchup.userTotal)} vs ${week.opponentName} ${fmt(matchup.opponentTotal)} (${fmtSigned(matchup.margin, marginSign)})`,
  ];

  for (const row of rows) {
    const ev = row.evaluation;
    const status = advisorStatusLabel(ev);
    const parts = [
      `${row.slot}: ${row.player.name}`,
      `B ${fmt(ev.bankedScore)}`,
      status,
      `${ev.remainingGamesCount}g left`,
    ];
    if (ev.status === "DECISION") {
      parts.push(`Beat ${fmtPct(ev.beatRate)}`, `EV ${fmtSignedEv(ev.rideEV)}`);
    } else if (ev.status === "LOCKED" && ev.latestLegGame !== null) {
      parts.push(`vs latest ${fmtSignedEv(ev.lockGainVsLatest)}`);
    }
    lines.push(parts.join(" | "));
  }

  return lines.join("\n");
}

/**
 * Formats a shareable plain-text summary of the Weekly Matchup view.
 * Never includes `mean` or reads `expectedTotal`.
 */
export function formatMatchupSummary(
  week: WeekRecord,
  evalResult: MatchupEvaluation,
  swings: BenchSwingRecommendation[],
): string {
  const marginSign = evalResult.margin >= 0 ? "+" : "-";
  const lines: string[] = [
    `Weekly Matchup — Leg ${week.leg} (${week.startDate} to ${week.endDate})`,
    `Beltline Ballers: ${fmt(evalResult.userTotal)} vs ${week.opponentName}: ${fmt(evalResult.opponentTotal)} (${fmtSigned(evalResult.margin, marginSign)})`,
    `User Bounds: Best ${fmt(evalResult.userBestCase)} / Worst ${fmt(evalResult.userWorstCase)}`,
    `Starter Games Left: ${evalResult.totalStarterRemainingGames} (${evalResult.unlockedStarterRemainingGames} unlocked)`,
  ];

  if (swings.length === 0) {
    lines.push("Bench Swings: None");
  } else {
    lines.push("Bench Swings:");
    for (const s of swings) {
      const lockFlag = s.starterLocked ? " [Starter LOCKED]" : "";
      lines.push(
        `- ${s.benchPlayer.name} (${fmt(s.benchValue)}) -> ${s.slot} ${s.starterPlayer.name} (${fmt(s.starterBanked)}): ${fmtSigned(s.swing, "+")}${lockFlag}`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Formats a shareable plain-text summary of a Player Detail view.
 * `mean` is included ONLY here and explicitly labelled `Mean (ref only)`.
 */
export function formatPlayerSummary(
  player: Player,
  analysis: PlayerAnalytics,
  windowLabel: string,
): string {
  const s = analysis.summary;
  const statusLabel =
    player.rosterStatus === "starter"
      ? "Starter"
      : player.rosterStatus === "bench"
        ? "Bench"
        : "Reserve / IR";
  const lastStr =
    s.lastGame !== null
      ? `${fmt(s.lastGame.total)} (${s.lastGame.log.opponent} ${fmtShortDate(s.lastGame.log.date)})`
      : "—";

  return [
    `${player.name} (${player.positions.join(" / ")} · ${player.team} · ${statusLabel}) — ${windowLabel}`,
    `GP: ${s.gamesPlayed} | Ceiling: ${fmt(s.ceiling)} | Median: ${fmt(s.median)} | Floor: ${fmt(s.floor)}`,
    `Last Game: ${lastStr} | Mean (ref only): ${fmt(s.mean)}`,
  ].join("\n");
}

/** Escapes a single cell value according to RFC-4180. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

function fmtCsvNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return n.toFixed(2);
}

/**
 * Builds an RFC-4180 CSV for RosterView rows.
 * Columns: Player,Team,Pos,Status,Ceiling,Median,Floor,Last Game,GP
 * Never includes `mean`.
 */
export function buildRosterCsv(
  rows: Array<{
    player: Player;
    summary?: PlayerAnalytics["summary"];
    analysis?: PlayerAnalytics;
  }>,
): string {
  const header = csvRow([
    "Player",
    "Team",
    "Pos",
    "Status",
    "Ceiling",
    "Median",
    "Floor",
    "Last Game",
    "GP",
  ]);
  const body = rows.map((row) => {
    const { player } = row;
    const s = row.summary ?? row.analysis?.summary;
    const statusLabel =
      player.rosterStatus === "starter"
        ? "Starter"
        : player.rosterStatus === "bench"
          ? "Bench"
          : "Reserve";
    return csvRow([
      player.name,
      player.team,
      player.positions.join(" / "),
      statusLabel,
      fmtCsvNum(s?.ceiling),
      fmtCsvNum(s?.median),
      fmtCsvNum(s?.floor),
      fmtCsvNum(s?.lastGame?.total),
      String(s?.gamesPlayed ?? 0),
    ]);
  });
  return [header, ...body].join("\r\n");
}

/**
 * Builds an RFC-4180 CSV for a player's scored game logs.
 * Columns: Date,Opponent,Total,Pts,Reb,Ast,Stl,Blk,Tov,TF,FF,Source
 * Never reads `expectedTotal`.
 */
export function buildPlayerLogsCsv(
  player: Player,
  logs: Array<ScoredGame | GameLog>,
): string {
  void player;
  const header = csvRow([
    "Date",
    "Opponent",
    "Total",
    "Pts",
    "Reb",
    "Ast",
    "Stl",
    "Blk",
    "Tov",
    "TF",
    "FF",
    "Source",
  ]);
  const body = logs.map((g) => {
    const log = "log" in g ? g.log : g;
    const total = "log" in g ? g.total : fantasyPoints(g).total;
    return csvRow([
      log.date,
      log.opponent,
      total.toFixed(2),
      String(log.pts),
      String(log.reb),
      String(log.ast),
      String(log.stl),
      String(log.blk),
      String(log.tov),
      String(log.tf ?? 0),
      String(log.ff ?? 0),
      log.source,
    ]);
  });
  return [header, ...body].join("\r\n");
}

function fallbackCopyWithTextarea(text: string): boolean {
  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}

/**
 * Copies text to the system clipboard using `navigator.clipboard?.writeText`,
 * falling back to a temporary `<textarea>` + `document.execCommand("copy")`.
 * Returns false gracefully if clipboard is unavailable or rejects.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }
  return fallbackCopyWithTextarea(text);
}

/**
 * Triggers a client-side CSV file download using Blob + <a download> + URL.createObjectURL.
 * Prefixes UTF-8 BOM (\uFEFF) so spreadsheet apps preserve UTF-8 characters.
 */
export function downloadCsv(filename: string, csvContent: string): void {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }
  const bomContent = csvContent.startsWith("\uFEFF") ? csvContent : `\uFEFF${csvContent}`;
  const blob = new Blob([bomContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}
