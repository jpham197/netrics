import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const DATA_FILES = ["players.json", "game-logs.json", "weeks.json", "locks.json"];

/**
 * Copies data/*.json into the Vite output (and serves them in dev).
 *
 * The UI loads data at runtime with fetch("data/players.json") instead of
 * importing the JSON at build time. That keeps the single source of truth
 * in data/*.json (no duplicated copy to drift) and keeps tsc's rootDir
 * ("src") untouched, so `npm run validate` still finds its CLI at
 * dist/data/validate-cli.js. The Vite output goes to dist-web/, never dist/,
 * so a Vite build can never wipe the tsc output.
 */
function dataFilesPlugin(): Plugin {
  let outDir = "dist-web";
  return {
    name: "netrics-data-files",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        const match = url.match(/^\/data\/(players\.json|game-logs\.json|weeks\.json|locks\.json)(\?.*)?$/);
        if (!match) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(
          // Served from the repo data/ dir in dev; no copy involved.
          readFileSync(resolve(server.config.root, "data", match[1] as string)),
        );
      });
    },
    writeBundle() {
      mkdirSync(join(outDir, "data"), { recursive: true });
      for (const file of DATA_FILES) {
        copyFileSync(resolve("data", file), join(outDir, "data", file));
      }
    },
  };
}

export default defineConfig({
  // Relative base so the built app works both at the domain root (local
  // preview) and under /netrics/ on GitHub Pages.
  base: "./",
  build: {
    // Deliberately NOT "dist": tsc owns dist/ (validate CLI lives there).
    outDir: "dist-web",
  },
  plugins: [dataFilesPlugin()],
});
