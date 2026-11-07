// `npm run ingest:espn` CLI — Phase 6 ESPN Box-Score Game-Log Ingestion & Sleeper Reconciliation
// (`docs/design/NETRICS-DESIGN.md` §9.3 & `docs/decisions/0005-espn-game-log-ingestion.md`).
//
// Usage:
//   npm run ingest:espn -- --date YYYY-MM-DD [--date YYYY-MM-DD ...] [--verify-existing] [--out <path>]
//
// Read-only by default (prints human-readable report + proposed GameLog[] JSON to stdout).
// When `--out <path>` is provided, writes the proposed GameLog[] JSON array to `<path>`,
// refusing any target path inside `data/`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll } from "../data/load.js";
import {
  formatIngestionReport,
  runEspnIngestion,
  validateSafeOutPath,
} from "./ingest.js";

export interface ParsedIngestCliArgs {
  dates: string[];
  verifyExisting: boolean;
  outPath: string | null;
}

const DATE_ARG_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_ARG_RE.test(dateStr)) return false;
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateStr;
}

export function parseIngestCliArgs(
  argv: string[],
  repoRoot = process.cwd(),
): ParsedIngestCliArgs {
  const dates: string[] = [];
  let verifyExisting = false;
  let outPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--verify-existing") {
      verifyExisting = true;
    } else if (arg === "--date") {
      const next = argv[++i];
      if (!next || !isValidCalendarDate(next)) {
        throw new Error(
          `Invalid or missing --date value ${JSON.stringify(next ?? "")}: expected valid YYYY-MM-DD`,
        );
      }
      if (!dates.includes(next)) dates.push(next);
    } else if (arg.startsWith("--date=")) {
      const val = arg.slice("--date=".length);
      if (!isValidCalendarDate(val)) {
        throw new Error(
          `Invalid --date value ${JSON.stringify(val)}: expected valid YYYY-MM-DD`,
        );
      }
      if (!dates.includes(val)) dates.push(val);
    } else if (arg === "--out") {
      const next = argv[++i];
      if (!next) {
        throw new Error("Missing value for --out <path>");
      }
      outPath = validateSafeOutPath(next, repoRoot);
    } else if (arg.startsWith("--out=")) {
      const val = arg.slice("--out=".length);
      outPath = validateSafeOutPath(val, repoRoot);
    } else {
      throw new Error(
        `Unknown CLI argument ${JSON.stringify(arg)}. Usage: npm run ingest:espn -- --date YYYY-MM-DD [--date YYYY-MM-DD ...] [--verify-existing] [--out <path>]`,
      );
    }
  }

  if (dates.length === 0) {
    throw new Error(
      "At least one --date YYYY-MM-DD argument is required. Usage: npm run ingest:espn -- --date YYYY-MM-DD [--verify-existing] [--out <path>]",
    );
  }

  return {
    dates,
    verifyExisting,
    outPath,
  };
}

async function main(): Promise<void> {
  const parsed = parseIngestCliArgs(process.argv.slice(2));
  const { players, logs, weeks, locks, espnPlayerMap } = loadAll();

  const report = await runEspnIngestion({
    dates: parsed.dates,
    verifyExisting: parsed.verifyExisting,
    playersFile: players,
    espnPlayerMap,
    existingLogs: logs,
    weeksFile: weeks,
    locksFile: locks,
  });

  console.log(formatIngestionReport(report));

  if (parsed.outPath !== null) {
    mkdirSync(dirname(parsed.outPath), { recursive: true });
    writeFileSync(parsed.outPath, `${JSON.stringify(report.proposedLogs, null, 2)}\n`, "utf-8");
    console.log(`Wrote ${report.proposedLogs.length} proposed game log(s) to ${parsed.outPath}`);
  }

  process.exitCode = report.hasFailures ? 1 : 0;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolvePathSafe(fileURLToPath(import.meta.url)) === resolvePathSafe(process.argv[1]);

export function resolvePathSafe(p: string): string {
  try {
    return resolve(p);
  } catch {
    return "";
  }
}

if (isDirectExecution) {
  main().catch((err: unknown) => {
    console.error(`ingest:espn FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
