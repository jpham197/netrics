// `npm run ingest:espn` CLI — Phase 6 ESPN Box-Score Game-Log Ingestion & Sleeper Reconciliation
// (`docs/design/NETRICS-DESIGN.md` §9.3, §9.5 & `docs/decisions/0005-espn-game-log-ingestion.md`, `0006-nightly-ingestion-schedule.md`).
//
// Usage:
//   npm run ingest:espn -- --date YYYY-MM-DD [--date YYYY-MM-DD ...] [--window-eastern]
//     [--verify-existing] [--out <path>] [--allow-reconcile-flags] [--apply-to-data] [--pr-meta-out <path>]
//
// Read-only by default (prints human-readable report + proposed GameLog[] JSON to stdout).
// When `--out <path>` is provided, writes the proposed GameLog[] JSON array to `<path>`,
// refusing any target path inside `data/`.
// When `--apply-to-data` is provided (used by `.github/workflows/ingest-nightly.yml` on `ingest/YYYY-MM-DD`),
// applies non-empty `proposedLogs` to `data/game-logs.json`, `data/weeks.json`, and `data/players.json`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll } from "../data/load.js";
import {
  applyIngestionProposal,
  buildNightlyPrMetadata,
  computeEasternDateWindow,
  formatIngestionReport,
  runEspnIngestion,
  validateSafeOutPath,
} from "./ingest.js";

export interface ParsedIngestCliArgs {
  dates: string[];
  verifyExisting: boolean;
  outPath: string | null;
  windowEastern: boolean;
  allowReconcileFlags: boolean;
  applyToData: boolean;
  prMetaOutPath: string | null;
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
  now?: Date,
): ParsedIngestCliArgs {
  const dates: string[] = [];
  let verifyExisting = false;
  let outPath: string | null = null;
  let windowEastern = false;
  let allowReconcileFlags = false;
  let applyToData = false;
  let prMetaOutPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--verify-existing") {
      verifyExisting = true;
    } else if (arg === "--window-eastern") {
      windowEastern = true;
    } else if (arg === "--allow-reconcile-flags") {
      allowReconcileFlags = true;
    } else if (arg === "--apply-to-data") {
      applyToData = true;
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
    } else if (arg === "--pr-meta-out") {
      const next = argv[++i];
      if (!next) {
        throw new Error("Missing value for --pr-meta-out <path>");
      }
      prMetaOutPath = validateSafeOutPath(next, repoRoot);
    } else if (arg.startsWith("--pr-meta-out=")) {
      const val = arg.slice("--pr-meta-out=".length);
      prMetaOutPath = validateSafeOutPath(val, repoRoot);
    } else {
      throw new Error(
        `Unknown CLI argument ${JSON.stringify(arg)}. Usage: npm run ingest:espn -- --date YYYY-MM-DD [--date YYYY-MM-DD ...] [--window-eastern] [--verify-existing] [--out <path>] [--allow-reconcile-flags] [--apply-to-data] [--pr-meta-out <path>]`,
      );
    }
  }

  if (dates.length === 0 && windowEastern) {
    const window = computeEasternDateWindow(now);
    dates.push(...window.dates);
  }

  if (dates.length === 0) {
    throw new Error(
      "At least one --date YYYY-MM-DD argument (or --window-eastern) is required. Usage: npm run ingest:espn -- --date YYYY-MM-DD [--verify-existing] [--out <path>]",
    );
  }

  if (verifyExisting && applyToData) {
    throw new Error(
      "Cannot combine --verify-existing (read-only audit mode) with --apply-to-data",
    );
  }

  return {
    dates,
    verifyExisting,
    outPath,
    windowEastern,
    allowReconcileFlags,
    applyToData,
    prMetaOutPath,
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

  if (parsed.applyToData && report.proposedLogs.length > 0) {
    const { updatedLogs, updatedWeeks, updatedPlayers } = applyIngestionProposal({
      report,
      playersFile: players,
      existingLogs: logs,
      weeksFile: weeks,
      espnPlayerMap,
    });
    writeFileSync(resolve("data/game-logs.json"), `${JSON.stringify(updatedLogs, null, 2)}\n`, "utf-8");
    writeFileSync(resolve("data/weeks.json"), `${JSON.stringify(updatedWeeks, null, 2)}\n`, "utf-8");
    writeFileSync(resolve("data/players.json"), `${JSON.stringify(updatedPlayers, null, 2)}\n`, "utf-8");
    console.log(
      `Applied ${report.proposedLogs.length} proposed game log(s) to data/game-logs.json, data/weeks.json, and data/players.json (asOf ${updatedPlayers.asOf})`,
    );
  }

  if (parsed.prMetaOutPath !== null) {
    const prMeta = buildNightlyPrMetadata(report);
    const metaPayload = {
      proposedCount: report.proposedLogs.length,
      datesRequested: report.dates,
      branchName: prMeta.branchName,
      title: prMeta.title,
      body: prMeta.body,
      hasReconcileFlags: prMeta.hasReconcileFlags,
    };
    mkdirSync(dirname(parsed.prMetaOutPath), { recursive: true });
    writeFileSync(parsed.prMetaOutPath, `${JSON.stringify(metaPayload, null, 2)}\n`, "utf-8");
    console.log(`Wrote nightly PR metadata to ${parsed.prMetaOutPath}`);
  }

  const shouldFail = parsed.allowReconcileFlags
    ? report.verifyDiffFlags.length > 0 || report.errors.length > 0
    : report.hasFailures;
  process.exitCode = shouldFail ? 1 : 0;
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

