// Stage 5a unit tests — runtime live matchup parser, fetcher, and 15s cooldown cache.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchLiveMatchup,
  LIVE_MATCHUP_COOLDOWN_MS,
  parseLiveMatchup,
  resetLiveMatchupCache,
} from "./liveMatchup.js";

function make12RosterPayload(overrides?: {
  userPoints?: unknown;
  oppPoints?: unknown;
  userMatchupId?: unknown;
  oppMatchupId?: unknown;
}) {
  return [
    {
      roster_id: 1,
      matchup_id: overrides?.userMatchupId ?? 4,
      points: overrides?.userPoints ?? 407.25,
      starters: ["2267", "4737", "4750", "2714", "2181", "1752", "1739", "2441", "2713"],
      starters_points: [61.75, 37.75, 41.75, 57.0, 46.75, 47.5, 35.5, 38.0, 41.25],
      players_points: {
        "2267": 61.75,
        "4737": 37.75,
        "4750": 41.75,
        "2714": 57.0,
        "2181": 46.75,
        "1752": 47.5,
        "1739": 35.5,
        "2441": 38.0,
        "2713": 41.25,
        "1074": 42.25,
      },
    },
    ...Array.from({ length: 10 }, (_, idx) => {
      const rosterId = idx + 2 >= 8 ? idx + 3 : idx + 2;
      return {
        roster_id: rosterId,
        matchup_id: (idx % 3) + 1,
        points: 300 + idx * 5,
        starters: ["9001"],
        players_points: { "9001": 30.0 },
      };
    }),
    {
      roster_id: 8,
      matchup_id: overrides?.oppMatchupId ?? 4,
      points: overrides?.oppPoints ?? 342.5,
      starters: ["3001", "3002", "0"],
      starters_points: [48.25, 39.5, 0],
      players_points: {
        "3001": 48.25,
        "3002": 39.5,
      },
    },
  ];
}

describe("parseLiveMatchup & fetchLiveMatchup (Stage 5a)", () => {
  beforeEach(() => {
    resetLiveMatchupCache();
  });

  it("parses a valid 12-roster response into LiveMatchup with user and opponent starters", () => {
    const payload = make12RosterPayload();
    const res = parseLiveMatchup(payload, 3, 8, 4, "2026-11-07T20:00:00.000Z");

    expect(res.leg).toBe(3);
    expect(res.matchupId).toBe(4);
    expect(res.fetchedAt).toBe("2026-11-07T20:00:00.000Z");
    expect(res.userPoints).toBe(407.25);
    expect(res.opponentRosterId).toBe(8);
    expect(res.opponentPoints).toBe(342.5);
    expect(res.userStarters.length).toBe(9);
    expect(res.userStarters[0]).toEqual({ sleeperId: "2267", points: 61.75 });
    // Filters out "0" empty starter placeholder
    expect(res.opponentStarters).toEqual([
      { sleeperId: "3001", points: 48.25 },
      { sleeperId: "3002", points: 39.5 },
    ]);
  });

  it("caches within LIVE_MATCHUP_COOLDOWN_MS (15s) and refetches after 15s or when force=true", async () => {
    let clock = 1_000_000;
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      const body = make12RosterPayload({ oppPoints: 317.25 + callCount * 10 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const first = await fetchLiveMatchup("1358656481750171649", 3, 8, 4, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => clock,
    });
    expect(first.opponentPoints).toBe(327.25);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Within 15s cooldown -> returns cached result without calling fetchMock
    clock += LIVE_MATCHUP_COOLDOWN_MS - 1;
    const cached = await fetchLiveMatchup("1358656481750171649", 3, 8, 4, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => clock,
    });
    expect(cached.opponentPoints).toBe(327.25);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // After 15s cooldown -> refetches
    clock += 2;
    const second = await fetchLiveMatchup("1358656481750171649", 3, 8, 4, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => clock,
    });
    expect(second.opponentPoints).toBe(337.25);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // force: true bypasses cooldown
    const forced = await fetchLiveMatchup("1358656481750171649", 3, 8, 4, {
      force: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => clock,
    });
    expect(forced.opponentPoints).toBe(347.25);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws descriptive errors on network failure, HTTP 500, non-array JSON, missing roster, mismatched matchup_id, and non-finite points", async () => {
    const networkFail = vi.fn(async () => {
      throw new Error("Network offline");
    });
    await expect(
      fetchLiveMatchup("1358656481750171649", 3, 8, 4, {
        fetchImpl: networkFail as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Network offline");

    const http500 = vi.fn(async () => new Response("Internal Error", { status: 500 }));
    await expect(
      fetchLiveMatchup("1358656481750171649", 3, 8, 4, {
        fetchImpl: http500 as unknown as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 500");

    expect(() => parseLiveMatchup({ not: "an array" }, 3, 8, 4)).toThrow(
      "must be a JSON array",
    );

    expect(() => parseLiveMatchup([{ roster_id: 2, matchup_id: 4, points: 100 }], 3, 8, 4)).toThrow(
      "missing user entry (roster_id: 1)",
    );

    expect(() => parseLiveMatchup([{ roster_id: 1, matchup_id: 4, points: 100 }], 3, 8, 4)).toThrow(
      "missing opponent entry (roster_id: 8)",
    );

    expect(() =>
      parseLiveMatchup(make12RosterPayload({ oppMatchupId: 2 }), 3, 8, 4),
    ).toThrow("Matchup ID mismatch");

    expect(() =>
      parseLiveMatchup(make12RosterPayload({ userMatchupId: 2, oppMatchupId: 2 }), 3, 8, 4),
    ).toThrow("Expected matchup_id 4");

    expect(() =>
      parseLiveMatchup(make12RosterPayload({ oppPoints: "NaN" }), 3, 8, 4),
    ).toThrow("Invalid points on opponent entry");
  });
});
