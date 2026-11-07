// `npm run validate` CLI.
// Usage: node dist/data/validate-cli.js [players.json] [game-logs.json]
// Defaults (relative to the working directory, i.e. the repo root):
//   data/players.json  data/game-logs.json
// Exits 0 when every v1.0 §4 invariant holds, 1 otherwise.

import { resolve } from "node:path";
import { loadGameLogs, loadPlayers } from "./load.js";
import { validateAll } from "./validate.js";

const playersPath = resolve(process.argv[2] ?? "data/players.json");
const logsPath = resolve(process.argv[3] ?? "data/game-logs.json");

try {
  const players = loadPlayers(playersPath);
  const logs = loadGameLogs(logsPath);
  const errors = validateAll(players, logs);
  if (errors.length > 0) {
    console.error(`validate: FAILED — ${errors.length} error(s)`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `validate: OK — ${players.players.length} players (asOf ${players.asOf}), ${logs.length} game logs`,
  );
} catch (err) {
  console.error(`validate: FAILED — ${(err as Error).message}`);
  process.exit(1);
}
