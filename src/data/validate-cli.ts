// `npm run validate` CLI.
// Usage: node dist/data/validate-cli.js [players.json] [game-logs.json] [weeks.json] [locks.json]
// Defaults (relative to the working directory, i.e. the repo root):
//   data/players.json  data/game-logs.json  data/weeks.json  data/locks.json
// Exits 0 when every v1.0 §4 and Phase 3 v1.0 §3.1 invariant holds, 1 otherwise.

import { resolve } from "node:path";
import { loadGameLogs, loadLocks, loadPlayers, loadWeeks } from "./load.js";
import { validateAll } from "./validate.js";

const playersPath = resolve(process.argv[2] ?? "data/players.json");
const logsPath = resolve(process.argv[3] ?? "data/game-logs.json");
const weeksPath = resolve(process.argv[4] ?? "data/weeks.json");
const locksPath = resolve(process.argv[5] ?? "data/locks.json");

try {
  const players = loadPlayers(playersPath);
  const logs = loadGameLogs(logsPath);
  const weeks = loadWeeks(weeksPath);
  const locks = loadLocks(locksPath);
  const errors = validateAll(players, logs, weeks, locks);
  if (errors.length > 0) {
    console.error(`validate: FAILED — ${errors.length} error(s)`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `validate: OK — ${players.players.length} players (asOf ${players.asOf}), ${logs.length} game logs, ${weeks.weeks.length} week(s), ${locks.locks.length} lock(s)`,
  );
} catch (err) {
  console.error(`validate: FAILED — ${(err as Error).message}`);
  process.exit(1);
}
