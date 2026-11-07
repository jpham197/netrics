// Weekly Matchup + Bench Swing View — Phase 3 v1.0 §5, §6, §7.3 & Phase 5 §8.2 (FROZEN).
// Displays scoreboard card (Beltline Ballers vs opponentName, margin, user
// best/worst-case bounds, remaining starter games, editable opponent total),
// live Sleeper scoreboard status + manual Refresh button, starter breakdown,
// opponent player breakdown (live starters or saved snapshot), and the Bench
// Swing table ranked high -> low by swing.

import { useCallback, useEffect, useMemo, useState } from "react";
import { evaluateBenchSwings, evaluateMatchup } from "../advisor/index.js";
import { LEAGUE_ID, type GameLog, type LockRecord, type Player, type WeekRecord } from "../data/types.js";
import { fetchLiveMatchup, type LiveMatchup } from "../sleeper/liveMatchup.js";
import { fmt, fmtShortDate, fmtSigned } from "./format.js";

export function MatchupView({
  week,
  players,
  logs,
  locks,
  onSelectPlayer,
  fetchLive = fetchLiveMatchup,
}: {
  week: WeekRecord;
  players: Player[];
  logs: GameLog[];
  locks: LockRecord[];
  onSelectPlayer?: (sleeperId: string) => void;
  fetchLive?: typeof fetchLiveMatchup;
}) {
  const [prevLeg, setPrevLeg] = useState<number>(week.leg);
  const [live, setLive] = useState<LiveMatchup | null>(null);
  const [loadingLive, setLoadingLive] = useState<boolean>(false);
  const [hasCustomOverride, setHasCustomOverride] = useState<boolean>(false);
  const [opponentInput, setOpponentInput] = useState<string>(week.opponentPoints.toFixed(2));

  if (prevLeg !== week.leg) {
    setPrevLeg(week.leg);
    setLive(null);
    setHasCustomOverride(false);
    setOpponentInput(week.opponentPoints.toFixed(2));
  }

  const runLiveFetch = useCallback(() => {
    let cancelled = false;
    setLoadingLive(true);
    fetchLive(LEAGUE_ID, week.leg, week.opponentRosterId, week.matchupId)
      .then((res) => {
        if (!cancelled) {
          setLive(res);
          setLoadingLive(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingLive(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchLive, week.leg, week.opponentRosterId, week.matchupId]);

  useEffect(() => {
    return runLiveFetch();
  }, [runLiveFetch]);

  const baselineOpponentPoints = live ? live.opponentPoints : week.opponentPoints;
  const displayedOpponentInput = hasCustomOverride
    ? opponentInput
    : baselineOpponentPoints.toFixed(2);

  const parsedOverride =
    displayedOpponentInput.trim() === "" ? NaN : Number(displayedOpponentInput);
  const effectiveOpponentPoints = hasCustomOverride
    ? Number.isFinite(parsedOverride)
      ? parsedOverride
      : baselineOpponentPoints
    : baselineOpponentPoints;

  const matchup = useMemo(
    () => evaluateMatchup(week, players, logs, locks, effectiveOpponentPoints),
    [week, players, logs, locks, effectiveOpponentPoints],
  );

  const swings = useMemo(
    () => evaluateBenchSwings(week, players, logs, locks),
    [week, players, logs, locks],
  );

  const opponentBySleeperId = useMemo(() => {
    const map = new Map<string, NonNullable<WeekRecord["opponentPlayers"]>[number]>();
    for (const op of week.opponentPlayers ?? []) {
      if (op.sleeperId) {
        map.set(op.sleeperId, op);
      }
    }
    return map;
  }, [week.opponentPlayers]);

  const marginSign = matchup.margin >= 0 ? "+" : "-";

  const hasLiveStarters = live !== null && live.opponentStarters.length > 0;
  const hasSavedOpponentPlayers =
    week.opponentPlayers !== undefined && week.opponentPlayers.length > 0;

  return (
    <div>
      <header className="page-header">
        <h1>Weekly Matchup — Leg {week.leg}</h1>
        <p className="sub">
          {week.startDate} to {week.endDate} · Matchup #{week.matchupId} · Opponent snapshot as of{" "}
          {week.opponentAsOf}
        </p>
        <div className="live-status-bar">
          <span
            className={`live-status-pill ${live ? "live-status-online" : "live-status-offline"}`}
            data-testid="matchup-live-status"
          >
            {live
              ? `Live · fetched ${live.fetchedAt}`
              : `Offline · showing saved scores as of ${week.opponentAsOf}`}
          </span>
          <button
            type="button"
            className="chip"
            data-testid="matchup-refresh-btn"
            disabled={loadingLive}
            onClick={() => {
              runLiveFetch();
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="summary-cards" data-testid="matchup-scoreboard">
        <div className="card">
          <div className="card-label">Beltline Ballers</div>
          <div className="card-value" data-testid="user-total">
            {fmt(matchup.userTotal)}
          </div>
          <div className="card-sub">
            {live ? `9 starters · Sleeper live: ${fmt(live.userPoints)}` : "9 starters"}
          </div>
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
            {matchup.unlockedStarterRemainingGames} unlocked ({matchup.unlockedStartersWithRemainingGames} of{" "}
            {matchup.startersWithRemainingGames} starters)
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
          value={displayedOpponentInput}
          onChange={(e) => {
            setHasCustomOverride(true);
            setOpponentInput(e.target.value);
          }}
          inputMode="decimal"
        />
        <button
          type="button"
          className="chip"
          onClick={() => {
            setHasCustomOverride(false);
            setOpponentInput(baselineOpponentPoints.toFixed(2));
          }}
        >
          Reset ({baselineOpponentPoints.toFixed(2)})
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

      {(hasLiveStarters || hasSavedOpponentPlayers) && (
        <section aria-label="Opponent Players">
          <h2>Opponent Breakdown ({week.opponentName})</h2>
          <div className="table-wrap">
            <table className="roster-table" data-testid="opponent-breakdown-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {hasLiveStarters
                  ? live.opponentStarters.map((starter, i) => {
                      const known = opponentBySleeperId.get(starter.sleeperId);
                      const displayName = known ? known.name : `Player #${starter.sleeperId}`;
                      return (
                        <tr key={`${starter.sleeperId}-${i}`}>
                          <td>
                            {displayName}
                            {known && (known.position || known.team) && (
                              <div className="player-meta">
                                {[known.position, known.team].filter(Boolean).join(" · ")}
                              </div>
                            )}
                          </td>
                          <td className="num">{fmt(starter.points)}</td>
                        </tr>
                      );
                    })
                  : (week.opponentPlayers ?? []).map((op, i) => (
                      <tr key={`${op.sleeperId ?? op.name}-${i}`}>
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

