// Roster View — spec v1.0 §6.1.
// Header: league name + snapshot date. Groups: Starters / Bench /
// Reserve / IR. Sortable by Ceiling, Median, or Last Game. Players with
// 0 games show GP 0 and "—" for ceiling/median/floor/last game.

import { useMemo, useState } from "react";
import { analyzePlayer, type PlayerAnalytics } from "../analytics/index.js";
import type { GameLog, Player, PlayersFile, RosterStatus } from "../data/types.js";
import { buildRosterCsv, downloadCsv } from "./exportShare.js";
import { fmt, fmtShortDate } from "./format.js";

export type RosterSort = "ceiling" | "median" | "lastGame";
export type PosFilter = "All" | "PG" | "SG" | "SF" | "PF" | "C";
export type StatusFilter = "All" | "Starters" | "Bench" | "Reserve";

const POS_FILTERS: PosFilter[] = ["All", "PG", "SG", "SF", "PF", "C"];
const STATUS_FILTERS: StatusFilter[] = ["All", "Starters", "Bench", "Reserve"];

const STATUS_MAP: Record<Exclude<StatusFilter, "All">, RosterStatus> = {
  Starters: "starter",
  Bench: "bench",
  Reserve: "reserve",
};

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
  searchQuery: controlledSearch,
  onSearchChange,
  posFilter: controlledPos,
  onPosFilterChange,
  statusFilter: controlledStatus,
  onStatusFilterChange,
}: {
  playersFile: PlayersFile;
  logs: GameLog[];
  onSelect: (sleeperId: string) => void;
  sort?: RosterSort;
  onSortChange?: (sort: RosterSort) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  posFilter?: PosFilter;
  onPosFilterChange?: (pos: PosFilter) => void;
  statusFilter?: StatusFilter;
  onStatusFilterChange?: (status: StatusFilter) => void;
}) {
  const [internalSort, setInternalSort] = useState<RosterSort>("ceiling");
  const [internalSearch, setInternalSearch] = useState<string>("");
  const [internalPos, setInternalPos] = useState<PosFilter>("All");
  const [internalStatus, setInternalStatus] = useState<StatusFilter>("All");
  const sort = controlledSort ?? internalSort;
  const searchQuery = controlledSearch ?? internalSearch;
  const posFilter = controlledPos ?? internalPos;
  const statusFilter = controlledStatus ?? internalStatus;

  const handleSortChange = (next: RosterSort) => {
    setInternalSort(next);
    onSortChange?.(next);
  };
  const handleSearchChange = (next: string) => {
    setInternalSearch(next);
    onSearchChange?.(next);
  };
  const handlePosChange = (next: PosFilter) => {
    setInternalPos(next);
    onPosFilterChange?.(next);
  };
  const handleStatusChange = (next: StatusFilter) => {
    setInternalStatus(next);
    onStatusFilterChange?.(next);
  };

  const allRows = useMemo<RowModel[]>(
    () =>
      playersFile.players.map((player) => ({
        player,
        analytics: analyzePlayer(player.sleeperId, logs),
      })),
    [playersFile, logs],
  );

  const rowsByGroup = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = allRows.filter(({ player }) => {
      if (
        q !== "" &&
        !player.name.toLowerCase().includes(q) &&
        !player.team.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (posFilter !== "All" && !player.positions.includes(posFilter)) {
        return false;
      }
      if (statusFilter !== "All" && player.rosterStatus !== STATUS_MAP[statusFilter]) {
        return false;
      }
      return true;
    });

    return GROUP_ORDER.map(({ status, label }) => ({
      label,
      rows: sortRows(
        filtered.filter((r) => r.player.rosterStatus === status),
        sort,
      ),
    })).filter((g) => g.rows.length > 0);
  }, [allRows, sort, searchQuery, posFilter, statusFilter]);

  return (
    <div>
      <header className="page-header">
        <h1>Beltline Ballers</h1>
        <p className="sub">Roster snapshot as of {playersFile.asOf}</p>
      </header>

      <div className="controls-row">
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

        <div className="filter-bar">
          <div className="filter-group">
            <input
              type="search"
              className="filter-search"
              placeholder="Search name or team..."
              aria-label="Search players"
              data-testid="roster-search-input"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <div className="filter-group" role="group" aria-label="Filter by position">
            <span className="filter-label">Pos</span>
            {POS_FILTERS.map((pos) => (
              <button
                key={pos}
                type="button"
                data-testid={`roster-pos-${pos}`}
                className={`chip${posFilter === pos ? " chip-active" : ""}`}
                aria-pressed={posFilter === pos}
                onClick={() => handlePosChange(pos)}
              >
                {pos}
              </button>
            ))}
          </div>

          <div className="filter-group" role="group" aria-label="Filter by roster status">
            <span className="filter-label">Status</span>
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                data-testid={`roster-status-${status}`}
                className={`chip${statusFilter === status ? " chip-active" : ""}`}
                aria-pressed={statusFilter === status}
                onClick={() => handleStatusChange(status)}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn-action"
          data-testid="export-roster-csv"
          onClick={() => {
            const filteredRows = rowsByGroup.flatMap((g) =>
              g.rows.map((r) => ({ player: r.player, analysis: r.analytics })),
            );
            downloadCsv(`netrics-roster-${playersFile.asOf}.csv`, buildRosterCsv(filteredRows));
          }}
        >
          Export CSV
        </button>
      </div>

      {rowsByGroup.length === 0 && (
        <div className="empty-note" data-testid="roster-empty">
          <p>No players match the current filters.</p>
          <button
            type="button"
            className="chip"
            data-testid="roster-reset-filters"
            onClick={() => {
              handleSearchChange("");
              handlePosChange("All");
              handleStatusChange("All");
            }}
          >
            Reset filters
          </button>
        </div>
      )}

      {rowsByGroup.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h2>{group.label}</h2>
          <div className="table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Ceiling</th>
                  <th scope="col" className="num">Median</th>
                  <th scope="col" className="num">Floor</th>
                  <th scope="col" className="num">Last Game</th>
                  <th scope="col" className="num">GP</th>
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
