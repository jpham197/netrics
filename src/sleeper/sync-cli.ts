// `npm run sync:sleeper` CLI — Stage 5b & ADR-0007 Roster & Week Sync (`docs/design/NETRICS-DESIGN.md` §8.3).
// Read-only by default (prints diff report and exits 1 when actionable diffs exist, 0 when in sync).
// With `--apply-to-data`, updates `data/players.json`, `data/weeks.json`, and `data/espn-player-map.json`
// (never modifies `data/locks.json` or `data/game-logs.json`).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSafeOutPath } from "../espn/ingest.js";
import { runSleeperSyncApply } from "./syncApply.js";

export interface ParsedSyncCliArgs {
  playersPath: string;
  weeksPath: string;
  applyToData: boolean;
  prMetaOutPath: string | null;
}

export function parseSyncCliArgs(
  argv: string[],
  repoRoot = process.cwd(),
): ParsedSyncCliArgs {
  const positional: string[] = [];
  let applyToData = false;
  let prMetaOutPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--apply-to-data") {
      applyToData = true;
    } else if (arg === "--pr-meta-out") {
      const next = argv[++i];
      if (!next) {
        throw new Error("Missing value for --pr-meta-out <path>");
      }
      prMetaOutPath = validateSafeOutPath(next, repoRoot);
    } else if (arg.startsWith("--pr-meta-out=")) {
      const val = arg.slice("--pr-meta-out=".length);
      prMetaOutPath = validateSafeOutPath(val, repoRoot);
    } else if (arg.startsWith("-")) {
      throw new Error(
        `Unknown CLI argument ${JSON.stringify(arg)}. Usage: npm run sync:sleeper -- [playersPath] [weeksPath] [--apply-to-data] [--pr-meta-out <path>]`,
      );
    } else {
      positional.push(arg);
    }
  }

  return {
    playersPath: resolve(repoRoot, positional[0] ?? "data/players.json"),
    weeksPath: resolve(repoRoot, positional[1] ?? "data/weeks.json"),
    applyToData,
    prMetaOutPath,
  };
}

async function main(): Promise<void> {
  const parsed = parseSyncCliArgs(process.argv.slice(2));

  const result = await runSleeperSyncApply({
    playersPath: parsed.playersPath,
    weeksPath: parsed.weeksPath,
    logsPath: resolve("data/game-logs.json"),
    espnMapPath: resolve("data/espn-player-map.json"),
    applyToData: parsed.applyToData,
  });

  console.log(result.report.textReport);

  if (!parsed.applyToData) {
    process.exitCode = result.report.hasActionableDiffs ? 1 : 0;
    return;
  }

  if (result.changed) {
    console.log(
      `Applied Sleeper sync (leg ${result.prMetadata.leg}) to players.json, weeks.json, and espn-player-map.json`,
    );
  } else {
    console.log("No changes to apply.");
  }

  if (parsed.prMetaOutPath !== null) {
    mkdirSync(dirname(parsed.prMetaOutPath), { recursive: true });
    writeFileSync(
      parsed.prMetaOutPath,
      `${JSON.stringify(result.prMetadata, null, 2)}\n`,
      "utf-8",
    );
    console.log(`Wrote Sleeper sync PR metadata to ${parsed.prMetaOutPath}`);
  }

  process.exitCode = 0;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
    } catch {
      return false;
    }
  })();

if (isDirectExecution) {
  main().catch((err: unknown) => {
    console.error(`sync:sleeper FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
