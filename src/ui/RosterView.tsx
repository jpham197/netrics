// Roster View — spec v1.0 §6.1.
// Header: league name + snapshot date. Groups: Starters / Bench /
// Reserve / IR. Sortable by Ceiling, Median, or Last Game. Players with
// 0 games show GP 0 and "—" for ceiling/median/floor/last game.

import { useMemo, useState } from "react";
import { analyzePlayer, type PlayerAnalytics } from "../analytics/index.js";
import type { GameLog, Player, PlayersFile, RosterStatus } from "../data/types.js";
import { fmt, fmtShortDate } from "./format.js";

export type RosterSort = "ceiling" | "median" | "lastGame";

const GROUP_ORDER: { status: RosterStatus; label: string }[] = [
  { status: "starter", label: "Starters" },
  { status: "bench", label: "Bench" },
  { status: "reserve", label: "Reserve / IR" },
];

interface RowModel {
  player: Player;
  analytics: PlayerAnalytics;
}

function sortKey(row: RowModel, sort: RosterSort): number | null {
  if (sort === "ceiling") return row.analytics.summary.ceiling;
  if (sort === "median") return row.analytics.summary.median;
  return row.analytics.summary.lastGame?.total ?? null;
}

function sortRows(rows: RowModel[], sort: RosterSort): RowModel[] {
  return [...rows].sort((a, b) => {
    const ka = sortKey(a, sort);
    const kb = sortKey(b, sort);
    // Players with no games (null key) sort last.
    if (ka === null && kb === null) return a.player.name.localeCompare(b.player.name);
    if (ka === null) return 1;
    if (kb === null) return -1;
    if (kb !== ka) return kb - ka;
    return a.player.name.localeCompare(b.player.name);
  });
}

export function RosterView({
  playersFile,
  logs,
  onSelect,
  sort: controlledSort,
  onSortChange,
}: {
  playersFile: PlayersFile;
  logs: GameLog[];
  onSelect: (sleeperId: string) => void;
  sort?: RosterSort;
  onSortChange?: (sort: RosterSort) => void;
}) {
  const [internalSort, setInternalSort] = useState<RosterSort>("ceiling");
  const sort = controlledSort ?? internalSort;
  const handleSortChange = (next: RosterSort) => {
    setInternalSort(next);
    onSortChange?.(next);
  };

  const rowsByGroup = useMemo(() => {
    const all: RowModel[] = playersFile.players.map((player) => ({
      player,
      analytics: analyzePlayer(player.sleeperId, logs),
    }));
    return GROUP_ORDER.map(({ status, label }) => ({
      label,
      rows: sortRows(
        all.filter((r) => r.player.rosterStatus === status),
        sort,
      ),
    })).filter((g) => g.rows.length > 0);
  }, [playersFile, logs, sort]);

  return (
    <div>
      <header className="page-header">
        <h1>Beltline Ballers</h1>
        <p className="sub">Roster snapshot as of {playersFile.asOf}</p>
      </header>

      <div className="sort-bar">
        <label htmlFor="roster-sort">Sort by</label>
        <select
          id="roster-sort"
          value={sort}
          onChange={(e) => handleSortChange(e.target.value as RosterSort)}
        >
          <option value="ceiling">Ceiling</option>
          <option value="median">Median</option>
          <option value="lastGame">Last Game</option>
        </select>
      </div>

      {rowsByGroup.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h2>{group.label}</h2>
          <div className="table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Ceiling</th>
                  <th className="num">Median</th>
                  <th className="num">Floor</th>
                  <th className="num">Last Game</th>
                  <th className="num">GP</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(({ player, analytics }) => {
                  const s = analytics.summary;
                  const last = s.lastGame;
                  return (
                    <tr key={player.sleeperId} data-testid={`player-row-${player.sleeperId}`}>
                      <td>
                        <button
                          type="button"
                          className="player-link"
                          onClick={() => onSelect(player.sleeperId)}
                        >
                          {player.name}
                        </button>
                        <div className="player-meta">
                          {player.positions.join(" / ")} · {player.team}
                        </div>
                      </td>
                      <td className="num">{fmt(s.ceiling)}</td>
                      <td className="num">{fmt(s.median)}</td>
                      <td className="num">{fmt(s.floor)}</td>
                      <td className="num">
                        {last === null ? (
                          "—"
                        ) : (
                          <>
                            {fmt(last.total)}
                            <div className="player-meta">
                              {last.log.opponent} {fmtShortDate(last.log.date)}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="num">{s.gamesPlayed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
