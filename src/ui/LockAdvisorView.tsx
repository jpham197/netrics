// Lock Advisor View — Phase 3 v1.0 §4 & §7.2 (FROZEN).
// Displays all 9 starters in slot order for the selected leg with their banked
// score B (+ game date/opponent + LOCKED / UNLOCKED badge), remaining games n
// (+ dates), beatRate, pAnyBeat, meanUpside, meanShortfall, rideEV, and
// recommendation badge (LOCK, RIDE, LEAN RIDE, LOCKED, FINAL, or NO BANKED),
// plus the stated model assumptions note (§4.3).

import { useMemo } from "react";
import {
  adviseWeek,
  evaluateMatchup,
  type LockDecisionEvaluation,
} from "../advisor/index.js";
import type { GameLog, LockRecord, Player, WeekRecord } from "../data/types.js";
import { fmt, fmtPct, fmtShortDate, fmtSigned } from "./format.js";

function renderBadge(ev: LockDecisionEvaluation) {
  if (ev.status === "LOCKED") {
    return <span className="rec-badge rec-locked">LOCKED</span>;
  }
  if (ev.status === "NO_GAMES_LEFT") {
    return <span className="rec-badge rec-final">FINAL</span>;
  }
  if (ev.status === "NO_BANKED_SCORE") {
    return <span className="rec-badge rec-final">NO BANKED</span>;
  }
  if (ev.recommendation === "LOCK") {
    return <span className="rec-badge rec-lock">LOCK</span>;
  }
  if (ev.recommendation === "RIDE") {
    return <span className="rec-badge rec-ride">RIDE</span>;
  }
  if (ev.recommendation === "LEAN_RIDE") {
    return <span className="rec-badge rec-lean">LEAN RIDE</span>;
  }
  return <span className="rec-badge rec-final">—</span>;
}

function fmtSignedEv(n: number): string {
  if (n > 0) return `+${n.toFixed(2)}`;
  if (n < 0) return `-${Math.abs(n).toFixed(2)}`;
  return "0.00";
}

export function LockAdvisorView({
  week,
  players,
  logs,
  locks,
  onSelectPlayer,
}: {
  week: WeekRecord;
  players: Player[];
  logs: GameLog[];
  locks: LockRecord[];
  onSelectPlayer: (sleeperId: string) => void;
}) {
  const rows = useMemo(
    () => adviseWeek(week, players, logs, locks),
    [week, players, logs, locks],
  );
  const matchup = useMemo(
    () => evaluateMatchup(week, players, logs, locks),
    [week, players, logs, locks],
  );

  return (
    <div>
      <header className="page-header">
        <h1>Lock Advisor — Leg {week.leg}</h1>
        <p className="sub">
          {week.startDate} to {week.endDate} · Matchup: Beltline Ballers {fmt(matchup.userTotal)} vs{" "}
          {week.opponentName} {fmt(matchup.opponentTotal)} (
          {matchup.margin >= 0
            ? fmtSigned(matchup.margin, "+")
            : fmtSigned(matchup.margin, "-")}
          )
        </p>
      </header>

      <div className="assumptions-note" data-testid="advisor-assumptions">
        <strong>Model Assumptions (§4.3):</strong>
        <ul>
          <li>
            <strong>Sequential first-beat stopping rule:</strong> Riding assumes you lock the{" "}
            <em>first</em> remaining game that strictly beats <code>B</code> (or end the week with
            the final game if none beat <code>B</code>).
          </li>
          <li>
            <strong>Independent full-season draws:</strong> Each remaining game is modelled as an
            independent draw from the player&apos;s own logged season distribution — never a season
            average.
          </li>
          <li>
            <strong>Per-starter evaluation:</strong> Each starter&apos;s expected value (
            <code>rideEV</code>) is computed independently; matchup margin is shown for context.
          </li>
        </ul>
      </div>

      <div className="table-wrap">
        <table className="roster-table advisor-table" data-testid="advisor-table">
          <thead>
            <tr>
              <th>Slot</th>
              <th>Player</th>
              <th className="num">Banked (B)</th>
              <th className="num">Games Left (n)</th>
              <th className="num">Beat Rate</th>
              <th className="num">P(Any Beat)</th>
              <th className="num">Mean Upside</th>
              <th className="num">Mean Shortfall</th>
              <th className="num">Ride EV</th>
              <th>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ slotIndex, slot, player, evaluation }) => {
              const ev = evaluation;
              const isLocked = ev.status === "LOCKED";
              return (
                <tr
                  key={`${slotIndex}-${player.sleeperId}`}
                  data-testid={`advisor-row-${player.sleeperId}`}
                >
                  <td>
                    <span className="slot-pill">{slot}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="player-link"
                      onClick={() => onSelectPlayer(player.sleeperId)}
                    >
                      {player.name}
                    </button>
                    <div className="player-meta">
                      {player.positions.join(" / ")} · {player.team} · {ev.gamesPlayed} GP
                    </div>
                  </td>
                  <td className="num">
                    <div>
                      <strong>{fmt(ev.bankedScore)}</strong>{" "}
                      <span
                        className={`lock-state-badge ${isLocked ? "state-locked" : "state-unlocked"}`}
                      >
                        {isLocked ? "LOCKED" : "UNLOCKED"}
                      </span>
                    </div>
                    {ev.bankedGameDate !== null && (
                      <div className="player-meta">
                        {ev.bankedOpponent ? `${ev.bankedOpponent} ` : ""}
                        {fmtShortDate(ev.bankedGameDate)}
                      </div>
                    )}
                    {isLocked && ev.latestLegGame !== null && (
                      <div className="player-meta" data-testid={`lock-gain-${player.sleeperId}`}>
                        vs latest ({fmt(ev.latestLegGame.total)}):{" "}
                        {fmtSignedEv(ev.lockGainVsLatest)}
                      </div>
                    )}
                  </td>
                  <td className="num">
                    <div>{ev.remainingGamesCount}</div>
                    {ev.remainingGameDates.length > 0 && (
                      <div className="player-meta">
                        {ev.remainingGameDates.map(fmtShortDate).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="num">
                    {ev.bankedScore === null || ev.gamesPlayed === 0 ? (
                      "—"
                    ) : (
                      <>
                        {fmtPct(ev.beatRate)}
                        <div className="player-meta">
                          {ev.beatCount}/{ev.gamesPlayed}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="num">
                    {isLocked || ev.bankedScore === null || ev.remainingGamesCount === 0
                      ? "—"
                      : fmtPct(ev.pAnyBeat)}
                  </td>
                  <td className="num">
                    {ev.bankedScore === null || ev.gamesPlayed === 0
                      ? "—"
                      : fmtSigned(ev.meanUpside, "+")}
                  </td>
                  <td className="num">
                    {ev.bankedScore === null || ev.gamesPlayed === 0
                      ? "—"
                      : fmtSigned(ev.meanShortfall, "-")}
                  </td>
                  <td className="num" data-testid={`ride-ev-${player.sleeperId}`}>
                    {isLocked ? (
                      "—"
                    ) : (
                      <strong>{fmtSignedEv(ev.rideEV)}</strong>
                    )}
                  </td>
                  <td data-testid={`rec-${player.sleeperId}`}>
                    <div>{renderBadge(ev)}</div>
                    {ev.status === "DECISION" && ev.nearCeiling && (
                      <div className="player-meta">
                        Near ceiling (max +{ev.maxGainToCeiling.toFixed(2)})
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
