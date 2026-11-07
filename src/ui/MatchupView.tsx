// Weekly Matchup + Bench Swing View — Phase 3 v1.0 §5, §6, §7.3 (FROZEN).
// Displays scoreboard card (Beltline Ballers vs opponentName, margin, user
// best/worst-case bounds, remaining starter games, editable opponent total),
// starter breakdown, optional opponent player breakdown, and the Bench Swing
// table ranked high -> low by swing.

import { useMemo, useState } from "react";
import { evaluateBenchSwings, evaluateMatchup } from "../advisor/index.js";
import type { GameLog, LockRecord, Player, WeekRecord } from "../data/types.js";
import { fmt, fmtShortDate, fmtSigned } from "./format.js";

export function MatchupView({
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
  onSelectPlayer?: (sleeperId: string) => void;
}) {
  const [prevLeg, setPrevLeg] = useState<number>(week.leg);
  const [opponentInput, setOpponentInput] = useState<string>(week.opponentPoints.toFixed(2));

  if (prevLeg !== week.leg) {
    setPrevLeg(week.leg);
    setOpponentInput(week.opponentPoints.toFixed(2));
  }

  const parsedOverride = opponentInput.trim() === "" ? NaN : Number(opponentInput);
  const effectiveOpponentPoints = Number.isFinite(parsedOverride)
    ? parsedOverride
    : week.opponentPoints;

  const matchup = useMemo(
    () => evaluateMatchup(week, players, logs, locks, effectiveOpponentPoints),
    [week, players, logs, locks, effectiveOpponentPoints],
  );

  const swings = useMemo(
    () => evaluateBenchSwings(week, players, logs, locks),
    [week, players, logs, locks],
  );

  const marginSign = matchup.margin >= 0 ? "+" : "-";

  return (
    <div>
      <header className="page-header">
        <h1>Weekly Matchup — Leg {week.leg}</h1>
        <p className="sub">
          {week.startDate} to {week.endDate} · Opponent snapshot as of {week.opponentAsOf}
        </p>
      </header>

      <div className="summary-cards" data-testid="matchup-scoreboard">
        <div className="card">
          <div className="card-label">Beltline Ballers</div>
          <div className="card-value" data-testid="user-total">
            {fmt(matchup.userTotal)}
          </div>
          <div className="card-sub">9 starters</div>
        </div>

        <div className="card">
          <div className="card-label">{week.opponentName}</div>
          <div className="card-value" data-testid="opponent-total">
            {fmt(matchup.opponentTotal)}
          </div>
          <div className="card-sub">Roster #{week.opponentRosterId}</div>
        </div>

        <div className="card">
          <div className="card-label">Margin</div>
          <div className="card-value" data-testid="matchup-margin">
            {fmtSigned(matchup.margin, marginSign)}
          </div>
          <div className="card-sub">
            {matchup.margin > 0 ? "Leading" : matchup.margin < 0 ? "Trailing" : "Tied"}
          </div>
        </div>

        <div className="card">
          <div className="card-label">User Bounds (Best / Worst)</div>
          <div className="card-value" data-testid="user-bounds">
            {fmt(matchup.userBestCase)} / {fmt(matchup.userWorstCase)}
          </div>
          <div className="card-sub">Bounds only, never predictions</div>
        </div>

        <div className="card">
          <div className="card-label">Starter Games Left</div>
          <div className="card-value" data-testid="starter-games-left">
            {matchup.totalStarterRemainingGames}
          </div>
          <div className="card-sub">
            {matchup.startersWithRemainingGames} of 9 starters active
          </div>
        </div>
      </div>

      <div className="target-row">
        <label htmlFor="opponent-total-input">Opponent score override</label>
        <input
          id="opponent-total-input"
          type="number"
          step="0.25"
          min="0"
          value={opponentInput}
          onChange={(e) => setOpponentInput(e.target.value)}
          inputMode="decimal"
        />
        <button
          type="button"
          className="chip"
          onClick={() => setOpponentInput(week.opponentPoints.toFixed(2))}
        >
          Reset ({week.opponentPoints.toFixed(2)})
        </button>
      </div>

      <section aria-label="Bench Swing">
        <h2>Bench Swing Recommendations</h2>
        <p className="sub">
          Positive point swaps (<code>swing &gt; 0</code>) respecting slot eligibility (
          <code>PG, SG, G, SF, PF, F, C, UTIL, UTIL</code>). Read-only advice — execute swaps in
          Sleeper.
        </p>
        {swings.length === 0 ? (
          <p className="empty-note">No positive bench-for-starter swaps available right now.</p>
        ) : (
          <div className="table-wrap">
            <table className="roster-table" data-testid="bench-swing-table">
              <thead>
                <tr>
                  <th>Bench Player</th>
                  <th className="num">Bench Score</th>
                  <th>Target Slot</th>
                  <th>Current Starter</th>
                  <th className="num">Starter Score</th>
                  <th className="num">Swing</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {swings.map((s) => (
                  <tr
                    key={`${s.benchPlayer.sleeperId}-${s.slotIndex}-${s.starterPlayer.sleeperId}`}
                    data-testid={`swing-row-${s.benchPlayer.sleeperId}-${s.slotIndex}`}
                  >
                    <td>
                      {onSelectPlayer ? (
                        <button
                          type="button"
                          className="player-link"
                          onClick={() => onSelectPlayer(s.benchPlayer.sleeperId)}
                        >
                          {s.benchPlayer.name}
                        </button>
                      ) : (
                        <strong>{s.benchPlayer.name}</strong>
                      )}
                      <div className="player-meta">
                        {s.benchPlayer.positions.join(" / ")} · {s.benchPlayer.team}
                      </div>
                    </td>
                    <td className="num">
                      <div>
                        <strong>{fmt(s.benchValue)}</strong>{" "}
                        <span
                          className={`lock-state-badge ${s.benchLocked ? "state-locked" : "state-unlocked"}`}
                        >
                          {s.benchLocked ? "LOCKED" : "UNLOCKED"}
                        </span>
                      </div>
                      {s.benchGameDate && (
                        <div className="player-meta">
                          {s.benchOpponent ? `${s.benchOpponent} ` : ""}
                          {fmtShortDate(s.benchGameDate)}
                        </div>
                      )}
                      {!s.benchLocked && s.benchRemainingGames > 0 && (
                        <div className="player-meta">
                          {s.benchRemainingGames}g left · Ride EV{" "}
                          {s.benchRideEV >= 0
                            ? fmtSigned(s.benchRideEV, "+")
                            : fmtSigned(s.benchRideEV, "-")}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="slot-pill">{s.slot}</span>
                    </td>
                    <td>
                      {onSelectPlayer ? (
                        <button
                          type="button"
                          className="player-link"
                          onClick={() => onSelectPlayer(s.starterPlayer.sleeperId)}
                        >
                          {s.starterPlayer.name}
                        </button>
                      ) : (
                        <strong>{s.starterPlayer.name}</strong>
                      )}
                      <div className="player-meta">
                        {s.starterPlayer.positions.join(" / ")} · {s.starterPlayer.team}
                      </div>
                    </td>
                    <td className="num">{fmt(s.starterBanked)}</td>
                    <td className="num">
                      <strong className="swing-positive">{fmtSigned(s.swing, "+")}</strong>
                    </td>
                    <td>
                      {s.starterLocked ? (
                        <span className="warning-flag" data-testid="starter-locked-warning">
                          Starter is LOCKED (moving to bench bench-stores their lock)
                        </span>
                      ) : (
                        <span className="player-meta">Starter unlocked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Starter Matchup Bounds">
        <h2>Starter Breakdown &amp; Week Bounds</h2>
        <div className="table-wrap">
          <table className="roster-table" data-testid="starter-bounds-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Starter</th>
                <th className="num">Current (B)</th>
                <th className="num">Games Left</th>
                <th className="num">Best Case</th>
                <th className="num">Worst Case</th>
              </tr>
            </thead>
            <tbody>
              {matchup.starterBounds.map((b) => (
                <tr
                  key={`${b.slotIndex}-${b.player.sleeperId}`}
                  data-testid={`bound-row-${b.player.sleeperId}`}
                >
                  <td>
                    <span className="slot-pill">{b.slot}</span>
                  </td>
                  <td>
                    {onSelectPlayer ? (
                      <button
                        type="button"
                        className="player-link"
                        onClick={() => onSelectPlayer(b.player.sleeperId)}
                      >
                        {b.player.name}
                      </button>
                    ) : (
                      <strong>{b.player.name}</strong>
                    )}
                    <div className="player-meta">
                      {b.player.positions.join(" / ")} · {b.player.team}
                    </div>
                  </td>
                  <td className="num">
                    {fmt(b.bankedScore)}{" "}
                    <span
                      className={`lock-state-badge ${b.isLocked ? "state-locked" : "state-unlocked"}`}
                    >
                      {b.isLocked ? "LOCKED" : "UNLOCKED"}
                    </span>
                  </td>
                  <td className="num">{b.remainingGamesCount}</td>
                  <td className="num">{fmt(b.bestCase)}</td>
                  <td className="num">{fmt(b.worstCase)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {week.opponentPlayers && week.opponentPlayers.length > 0 && (
        <section aria-label="Opponent Players">
          <h2>Opponent Breakdown ({week.opponentName})</h2>
          <div className="table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {week.opponentPlayers.map((op, i) => (
                  <tr key={`${op.name}-${i}`}>
                    <td>
                      {op.name}
                      {(op.position || op.team) && (
                        <div className="player-meta">
                          {[op.position, op.team].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="num">{fmt(op.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
