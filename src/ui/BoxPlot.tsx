// Hand-drawn horizontal SVG Box Plot — spec v1.0 §7.5 (FROZEN).
// Renders a five-number summary box plot (Q1–Q3 box, median line, min/max
// whiskers) when N >= 3, or individual game dots with a small-N note when
// N < 3. Also plots every game dot and an optional Banked (B) marker line
// (or out-of-range note), plus an accessible text readout underneath.

import type { FiveNumberSummary, ScoredGame } from "../analytics/index.js";
import { fmtShortDate } from "./format.js";

const SVG_WIDTH = 640;
const SVG_HEIGHT = 84;
const PAD_X = 28;
const CENTER_Y = 42;
const BOX_HALF_H = 16;
const CAP_HALF_H = 10;

export function BoxPlot({
  games,
  summary,
  bankedScore = null,
}: {
  games: ScoredGame[];
  summary: FiveNumberSummary;
  bankedScore?: number | null;
}) {
  const span = summary.max - summary.min;
  const domainMin = span === 0 ? summary.min - 1 : summary.min - 0.05 * span;
  const domainMax = span === 0 ? summary.max + 1 : summary.max + 0.05 * span;
  const domainSpan = domainMax - domainMin;

  const toX = (val: number): number => {
    const plotWidth = SVG_WIDTH - 2 * PAD_X;
    const ratio = (val - domainMin) / domainSpan;
    return PAD_X + Math.min(1, Math.max(0, ratio)) * plotWidth;
  };

  const xMin = toX(summary.min);
  const xQ1 = toX(summary.q1);
  const xMed = toX(summary.median);
  const xQ3 = toX(summary.q3);
  const xMax = toX(summary.max);

  const hasBanked = bankedScore !== null && bankedScore !== undefined;
  const bankedInRange =
    hasBanked && bankedScore >= summary.min && bankedScore <= summary.max;

  return (
    <section aria-label="Score Distribution Box Plot" className="boxplot-section" data-testid="boxplot-section">
      <h2>Score Distribution Box Plot</h2>
      {summary.n < 3 && (
        <p className="empty-note" data-testid="boxplot-small-n-note">
          Not enough games for a box plot — showing individual games.
        </p>
      )}
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="boxplot-svg"
        role="img"
        aria-label={`Box plot: Min ${summary.min.toFixed(2)}, Q1 ${summary.q1.toFixed(2)}, Median ${summary.median.toFixed(2)}, Q3 ${summary.q3.toFixed(2)}, Max ${summary.max.toFixed(2)}, IQR ${summary.iqr.toFixed(2)}`}
        data-testid="boxplot-svg"
      >
        {/* Baseline axis */}
        <line
          x1={PAD_X}
          y1={CENTER_Y}
          x2={SVG_WIDTH - PAD_X}
          y2={CENTER_Y}
          className="boxplot-axis"
        />

        {summary.n >= 3 && (
          <g data-testid="boxplot-box-group">
            {/* Left and right whiskers */}
            <line
              x1={xMin}
              y1={CENTER_Y}
              x2={xQ1}
              y2={CENTER_Y}
              className="boxplot-whisker"
              data-testid="boxplot-whisker-min"
            />
            <line
              x1={xQ3}
              y1={CENTER_Y}
              x2={xMax}
              y2={CENTER_Y}
              className="boxplot-whisker"
              data-testid="boxplot-whisker-max"
            />
            {/* Whisker end caps */}
            <line
              x1={xMin}
              y1={CENTER_Y - CAP_HALF_H}
              x2={xMin}
              y2={CENTER_Y + CAP_HALF_H}
              className="boxplot-cap"
            />
            <line
              x1={xMax}
              y1={CENTER_Y - CAP_HALF_H}
              x2={xMax}
              y2={CENTER_Y + CAP_HALF_H}
              className="boxplot-cap"
            />
            {/* Q1-Q3 box */}
            <rect
              x={xQ1}
              y={CENTER_Y - BOX_HALF_H}
              width={Math.max(1, xQ3 - xQ1)}
              height={BOX_HALF_H * 2}
              rx={3}
              className="boxplot-box"
              data-testid="boxplot-box"
            />
            {/* Median vertical line */}
            <line
              x1={xMed}
              y1={CENTER_Y - BOX_HALF_H}
              x2={xMed}
              y2={CENTER_Y + BOX_HALF_H}
              className="boxplot-median"
              data-testid="boxplot-median"
            />
          </g>
        )}

        {/* Banked score vertical marker when within [min, max] */}
        {bankedInRange && (
          <g data-testid="boxplot-banked-marker">
            <line
              x1={toX(bankedScore)}
              y1={10}
              x2={toX(bankedScore)}
              y2={SVG_HEIGHT - 8}
              className="boxplot-banked-line"
            />
            <text
              x={toX(bankedScore)}
              y={12}
              textAnchor="middle"
              className="boxplot-banked-label"
            >
              Banked ({bankedScore.toFixed(2)})
            </text>
          </g>
        )}

        {/* Individual game dots */}
        {games.map((game) => (
          <circle
            key={game.log.date}
            cx={toX(game.total)}
            cy={CENTER_Y}
            r={5}
            className={game.isSpike ? "boxplot-dot boxplot-dot-spike" : "boxplot-dot"}
            data-testid={`boxplot-dot-${game.log.date}`}
          >
            <title>
              {fmtShortDate(game.log.date)} {game.log.opponent}: {game.total.toFixed(2)}
            </title>
          </circle>
        ))}
      </svg>

      {hasBanked && !bankedInRange && (
        <p className="empty-note" data-testid="boxplot-banked-out-note">
          Banked ({bankedScore.toFixed(2)}) is outside the windowed range (
          {summary.min.toFixed(2)}–{summary.max.toFixed(2)}).
        </p>
      )}

      <div className="boxplot-readout" data-testid="boxplot-readout">
        <span>Min {summary.min.toFixed(2)}</span>
        <span>Q1 {summary.q1.toFixed(2)}</span>
        <span>Median {summary.median.toFixed(2)}</span>
        <span>Q3 {summary.q3.toFixed(2)}</span>
        <span>Max {summary.max.toFixed(2)}</span>
        <span>IQR {summary.iqr.toFixed(2)}</span>
      </div>
    </section>
  );
}
