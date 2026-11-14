// Player Detail View — spec v1.0 §7.5 (FROZEN).
// Time-window selector (Last week / Last 3 weeks / Last month / All season),
// summary cards (Ceiling / Median / Floor / Last Game / GP, plus muted
// "Mean (ref only)"), hand-drawn SVG Box Plot, Target Score Explorer (with
// optional Banked (B) quick-select chip when the player has a banked score
// in the active leg), and the game-by-game distribution with the 6-part
// breakdown per game.
// All numbers come from fantasyPoints() via analyzePlayer()/evaluateTarget();
// this view never reads GameLog.expectedTotal.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TIME_WINDOWS,
  analyzePlayer,
  evaluateTarget,
  filterLogsByWindow,
  fiveNumberSummary,
  sortDistribution,
  type ScoredGame,
  type TimeWindow,
} from "../analytics/index.js";
import type { GameLog, Player } from "../data/types.js";
import { BoxPlot } from "./BoxPlot.js";
import {
  buildPlayerLogsCsv,
  copyToClipboard,
  downloadCsv,
  formatPlayerSummary,
} from "./exportShare.js";
import { fmt, fmtPct, fmtShortDate, fmtSigned } from "./format.js";

type DistributionSort = "score" | "date";

function BreakdownLine({ game }: { game: ScoredGame }) {
  const b = game.score.breakdown;
  // The 6 parts always sum exactly to total (spec §3 invariant).
  return (
    <div className="breakdown" data-testid={`breakdown-${game.log.date}`}>
      <span>Pts {b.scoring.toFixed(2)}</span>
      <span>Reb {b.rebounds.toFixed(2)}</span>
      <span>Ast {b.playmaking.toFixed(2)}</span>
      <span>Stocks {b.stocks.toFixed(2)}</span>
      <span>Bonuses {b.bonuses.toFixed(2)}</span>
      <span>Penalties {b.penalties.toFixed(2)}</span>
      <span className="breakdown-total">= {game.total.toFixed(2)}</span>
    </div>
  );
}

export function PlayerDetail({
  player,
  logs,
  onBack,
  backLabel = "← Roster",
  bankedScore = null,
  asOf = "2026-11-07",
}: {
  player: Player;
  logs: GameLog[];
  onBack: () => void;
  backLabel?: string;
  bankedScore?: number | null;
  asOf?: string;
}) {
  const [prevSleeperId, setPrevSleeperId] = useState<string>(player.sleeperId);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const effectiveWindow: TimeWindow =
    prevSleeperId !== player.sleeperId ? "all" : timeWindow;

  const hasAnyPlayerLogs = useMemo(
    () => logs.some((l) => l.sleeperId === player.sleeperId),
    [logs, player.sleeperId],
  );
  const windowedLogs = useMemo(
    () => filterLogsByWindow(logs, effectiveWindow, asOf),
    [logs, effectiveWindow, asOf],
  );
  const analytics = useMemo(
    () => analyzePlayer(player.sleeperId, windowedLogs),
    [player, windowedLogs],
  );
  const summary = analytics.summary;
  const lastTotal = summary.lastGame?.total ?? null;

  const boxSummary = useMemo(
    () => fiveNumberSummary(analytics.distribution.map((g) => g.total)),
    [analytics],
  );

  const [prevWindow, setPrevWindow] = useState<TimeWindow>(effectiveWindow);
  const [targetText, setTargetText] = useState<string>(
    lastTotal === null ? "" : lastTotal.toFixed(2),
  );
  const [distSort, setDistSort] = useState<DistributionSort>("score");
  const [spikesOnly, setSpikesOnly] = useState<boolean>(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  if (prevSleeperId !== player.sleeperId) {
    setPrevSleeperId(player.sleeperId);
    setTimeWindow("all");
    setPrevWindow("all");
    setTargetText(lastTotal === null ? "" : lastTotal.toFixed(2));
    setDistSort("score");
    setSpikesOnly(false);
    setCopyStatus("idle");
  } else if (prevWindow !== effectiveWindow) {
    setPrevWindow(effectiveWindow);
    setTargetText(lastTotal === null ? "" : lastTotal.toFixed(2));
    setCopyStatus("idle");
  }

  const activeWindowLabel =
    TIME_WINDOWS.find((w) => w.id === effectiveWindow)?.label ?? "All season";

  const target = targetText.trim() === "" ? NaN : Number(targetText);
  const hasTarget = Number.isFinite(target);
  const evaluation = hasTarget ? evaluateTarget(analytics.distribution, target) : null;

  const chips = useMemo(() => {
    const totals = analytics.distribution.map((s) => s.total);
    return [...new Set(totals)].sort((a, b) => b - a);
  }, [analytics]);

  const games =
    distSort === "score"
      ? analytics.distribution
      : sortDistribution(analytics.distribution, "date").reverse();
  const visibleGames = spikesOnly ? games.filter((g) => g.isSpike === true) : games;

  const ceiling = summary.ceiling ?? 0;

  return (
    <div>
      <button type="button" className="back-button" onClick={onBack}>
        {backLabel}
      </button>

      <header className="page-header">
        <h1>{player.name}</h1>
        <p className="sub">
          {player.positions.join(" / ")} · {player.team} ·{" "}
          {player.rosterStatus === "starter"
            ? "Starter"
            : player.rosterStatus === "bench"
              ? "Bench"
              : "Reserve / IR"}{" "}
          · {activeWindowLabel}
        </p>
      </header>

      <div className="controls-row">
        <div className="window-bar" role="group" aria-label="Time window" data-testid="window-selector">
          {TIME_WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              data-testid={`window-chip-${w.id}`}
              className={`chip${effectiveWindow === w.id ? " chip-active" : ""}`}
              onClick={() => setTimeWindow(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className="action-bar">
          <button
            type="button"
            className={`btn-action${copyStatus === "copied" ? " btn-action-copied" : ""}`}
            data-testid="copy-player-summary"
            onClick={async () => {
              const ok = await copyToClipboard(
                formatPlayerSummary(player, analytics, activeWindowLabel),
              );
              if (!isMountedRef.current) return;
              setCopyStatus(ok ? "copied" : "error");
              if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
              copyTimerRef.current = setTimeout(() => {
                if (isMountedRef.current) setCopyStatus("idle");
              }, 2000);
            }}
          >
            {copyStatus === "copied" ? "Copied!" : "Copy Summary"}
          </button>
          <button
            type="button"
            className="btn-action"
            data-testid="export-player-csv"
            onClick={() => {
              downloadCsv(
                `netrics-${player.sleeperId}-${effectiveWindow}.csv`,
                buildPlayerLogsCsv(player, analytics.distribution),
              );
            }}
          >
            Export CSV
          </button>
          <span className="export-feedback" role="status" aria-live="polite">
            {copyStatus === "error" ? "Copy failed" : ""}
          </span>
        </div>
      </div>

      <div className="summary-cards" data-testid="summary-cards">
        <div className="card">
          <div className="card-label">Ceiling</div>
          <div className="card-value">{fmt(summary.ceiling)}</div>
        </div>
        <div className="card">
          <div className="card-label">Median</div>
          <div className="card-value">{fmt(summary.median)}</div>
        </div>
        <div className="card">
          <div className="card-label">Floor</div>
          <div className="card-value">{fmt(summary.floor)}</div>
        </div>
        <div className="card">
          <div className="card-label">Last Game</div>
          <div className="card-value">{fmt(lastTotal)}</div>
          {summary.lastGame !== null && (
            <div className="card-sub">
              {summary.lastGame.log.opponent} {fmtShortDate(summary.lastGame.log.date)}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-label">GP</div>
          <div className="card-value">{summary.gamesPlayed}</div>
        </div>
        <div className="card card-muted">
          <div className="card-label">Mean (ref only)</div>
          <div className="card-value">{fmt(summary.mean)}</div>
        </div>
      </div>

      {summary.gamesPlayed === 0 || boxSummary === null ? (
        <p className="empty-note">
          {hasAnyPlayerLogs && effectiveWindow !== "all"
            ? "No games logged in this window."
            : "No games logged yet for this player."}
        </p>
      ) : (
        <>
          <BoxPlot
            games={analytics.distribution}
            summary={boxSummary}
            bankedScore={bankedScore}
          />

          <section aria-label="Target Score Explorer">
            <h2>Target Score Explorer</h2>
            <div className="target-row">
              <label htmlFor="target-input">Target score</label>
              <input
                id="target-input"
                type="number"
                step="0.25"
                min="0"
                value={targetText}
                onChange={(e) => setTargetText(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div className="chips" aria-label="Game scores">
              {bankedScore !== null && (
                <button
                  type="button"
                  data-testid="banked-chip"
                  className={`chip chip-banked${hasTarget && target === bankedScore ? " chip-active" : ""}`}
                  onClick={() => setTargetText(bankedScore.toFixed(2))}
                >
                  Banked ({bankedScore.toFixed(2)})
                </button>
              )}
              {chips.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip${hasTarget && target === t ? " chip-active" : ""}`}
                  onClick={() => setTargetText(t.toFixed(2))}
                >
                  {t.toFixed(2)}
                </button>
              ))}
            </div>
            {evaluation === null ? (
              <p className="empty-note">Enter a target score to see the beat-rate.</p>
            ) : (
              <div data-testid="target-evaluation">
                <p className="beat-rate">
                  Beat-rate: {evaluation.beatCount} of {evaluation.gamesPlayed} games (
                  {fmtPct(evaluation.beatRate)})
                </p>
                <p>
                  Max Upside {fmtSigned(evaluation.maxUpside, "+")} · Max Downside{" "}
                  {fmtSigned(evaluation.maxDownside, "-")}
                </p>
                {evaluation.beatingGames.length === 0 ? (
                  <p className="empty-note">No game beat this target.</p>
                ) : (
                  <ul className="beating-list">
                    {evaluation.beatingGames.map((g) => (
                      <li key={g.log.date}>
                        {fmtShortDate(g.log.date)} {g.log.opponent} — {g.total.toFixed(2)} (+
                        {g.margin.toFixed(2)})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section aria-label="Game-by-Game Distribution">
            <h2>Game-by-Game Distribution</h2>
            <div className="sort-bar">
              <button
                type="button"
                className={distSort === "score" ? "toggle-active" : ""}
                onClick={() => setDistSort("score")}
              >
                High → Low
              </button>
              <button
                type="button"
                className={distSort === "date" ? "toggle-active" : ""}
                onClick={() => setDistSort("date")}
              >
                Latest → Oldest
              </button>
              <label className={`chip${spikesOnly ? " chip-active" : ""}`}>
                <input
                  type="checkbox"
                  data-testid="spikes-only-toggle"
                  checked={spikesOnly}
                  onChange={(e) => setSpikesOnly(e.target.checked)}
                />
                Spikes only
              </label>
            </div>
            {spikesOnly && visibleGames.length === 0 ? (
              <div className="empty-note" data-testid="spikes-empty">
                <p>No spike games in this window.</p>
                <button
                  type="button"
                  className="chip"
                  data-testid="spikes-reset-filters"
                  onClick={() => setSpikesOnly(false)}
                >
                  Reset filters
                </button>
              </div>
            ) : (
            <ul className="game-list">
              {visibleGames.map((game) => (
                <li
                  key={game.log.date}
                  className={game.isSpike ? "game-spike" : ""}
                  data-testid={`game-${game.log.date}`}
                >
                  <div className="game-head">
                    <span>
                      {fmtShortDate(game.log.date)} {game.log.opponent}
                    </span>
                    <span className="game-total">{game.total.toFixed(2)}</span>
                    {game.isSpike && (
                      <span className="spike-badge">
                        SPIKE · {game.primaryDriver ?? "scoring"}
                      </span>
                    )}
                  </div>
                  <div
                    className="game-bar"
                    style={{
                      width: `${ceiling > 0 ? Math.min(100, Math.max(2, (game.total / ceiling) * 100)) : 0}%`,
                    }}
                    aria-hidden="true"
                  />
                  <div className="game-line">
                    {game.log.pts} pts · {game.log.reb} reb · {game.log.ast} ast ·{" "}
                    {game.log.stl} stl · {game.log.blk} blk · {game.log.tov} tov
                    {game.log.tf ? ` · ${game.log.tf} tf` : ""}
                    {game.log.ff ? ` · ${game.log.ff} ff` : ""}
                  </div>
                  <BreakdownLine game={game} />
                </li>
              ))}
            </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
