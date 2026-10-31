// Shasta Lite on Base44 hosting: `bun run deploy:base44` (from the root, so the root .env is loaded).
// Base44 serves static files only (no headers of our own, no proxy, 50 MB / 1000 files per upload); the build itself
// is scripts/lib/liteBuild.ts. Cross-origin isolation comes from the service worker (first visit reloads once).
// Base44 project: .deploy/base44/base44/{config.jsonc,.app.jsonc} (`npx base44 create` / `link` once; gitignored).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { adEnv } from "./lib/adCodes";
import { buildLite, ROOT, run } from "./lib/liteBuild";

const PROJECT = join(ROOT, ".deploy/base44");
const OUT = join(PROJECT, "site");
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 1000;
const dry = process.argv.includes("--dry-run");

if (!existsSync(join(PROJECT, "base44/.app.jsonc"))) {
	console.error("no Base44 project in .deploy/base44: run `npx base44 create shasta-lite --path .deploy/base44 --template backend-only`,\nthen set \"site\": { \"outputDirectory\": \"./site\" } in .deploy/base44/base44/config.jsonc");
	process.exit(1);
}

// Umami website "Shasta Lite (Base44)"
// Ads: this host's own Adsterra codes (scripts/lib/adCodes.ts)
const { bytes, files } = buildLite(OUT, "ade53419-c9b4-4690-83e5-c232bab531e3", "/", adEnv("base44"));
if (bytes > MAX_BYTES || files > MAX_FILES) {
	console.error(`over Base44's limits (${MAX_BYTES / 1024 / 1024} MB, ${MAX_FILES} files): not uploaded`);
	process.exit(1);
}
if (dry) {
	console.log(`built in ${OUT} (--dry-run: not uploaded)`);
	process.exit(0);
}
run(["npx", "-y", "base44@latest", "site", "deploy", "-y", "--no-build"], PROJECT);
console.log("\x1b[33mpublic source must match what is hosted: run `bun run publish:source` (AGPL section 13)\x1b[0m");
