// Shasta Lite on Base44 hosting: `bun run deploy:base44` (from the root, so the root .env is loaded).
// Base44 serves static files only (no headers of our own, no proxy, 50 MB / 1000 files per upload), so this is a
// separate, smaller build of the same frontend (shasta/src/lib/edition.ts, VITE_EDITION=lite):
//   - browsing goes to the Wisp relay behind the Pages site (its worker forwards /wisp/ cross-origin; Wisp has no
//     Origin check);
//   - the Store, chat and the rest of /api go to the full site's backend across origins (lib/appApi.ts), which must
//     list this host in APP_ORIGINS (VPS /etc/shasta/shasta.env); always anonymous, so no staff sign-in here;
//   - the ONNX Runtime wasm (on-device AI, 26 MB twice) is left out, which is what makes it fit.
// Base44 cannot send COOP/COEP, so the service worker adds them (sw.js LITE_BUILD; first visit reloads once).
// It builds into .deploy/base44/site, never shasta/dist, so the Cloudflare staged build is untouched.
// Base44 project: .deploy/base44/base44/{config.jsonc,.app.jsonc} (`npx base44 create` / `link` once; gitignored).
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PROJECT = join(ROOT, ".deploy/base44");
const OUT = join(PROJECT, "site");
const FULL = "https://shasta-dtg.pages.dev";
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 1000;
const dry = process.argv.includes("--dry-run");

if (!existsSync(join(PROJECT, "base44/.app.jsonc"))) {
	console.error("no Base44 project in .deploy/base44: run `npx base44 create shasta-lite --path .deploy/base44 --template backend-only`,\nthen set \"site\": { \"outputDirectory\": \"./site\" } in .deploy/base44/base44/config.jsonc");
	process.exit(1);
}
for (const need of ["scramjet/packages/core/dist/scramjet.wasm", "shasta/public/adblock/engine.bin", "shasta/node_modules"]) {
	if (!existsSync(join(ROOT, need))) {
		console.error(`missing ${need}: run \`bun run build\` once first`);
		process.exit(1);
	}
}

const env: Record<string, string | undefined> = {
	...process.env,
	VITE_EDITION: "lite",
	VITE_WISP_URL: `wss://${new URL(FULL).host}/wisp/`,
	VITE_WISP_URLS: "",
	// share links and the canonical address name the full site, where a shared Store link actually opens
	VITE_SHARE_ORIGIN: FULL,
	VITE_SITE_ORIGIN: FULL,
	// the stats dashboard (Umami on the VPS, lib/stats.ts): Lite is its own website there ("Shasta Lite (Base44)"),
	// never the full site's id from .env, so the two show up side by side
	VITE_STATS_URL: process.env.VITE_STATS_URL || "https://stats.176-100-37-63.sslip.io",
	VITE_STATS_WEBSITE_ID: "ade53419-c9b4-4690-83e5-c232bab531e3",
};
// production rules: devtools shortcuts blocked, obfuscated chunks
delete env.VITE_ALLOW_DEVTOOLS;
delete env.VITE_OBFUSCATE;

run(["bunx", "vite", "build", "--outDir", OUT, "--emptyOutDir"], join(ROOT, "shasta"), env);

// the host sends no COOP/COEP: the service worker adds them to Shasta's own pages (public/sw.js LITE_BUILD)
const swPath = join(OUT, "sw.js");
const sw = readFileSync(swPath, "utf8");
if (!sw.includes('"__SHASTA_LITE__"')) {
	console.error("sw.js has no __SHASTA_LITE__ marker: cannot turn on isolation for Lite");
	process.exit(1);
}
writeFileSync(swPath, sw.replace('"__SHASTA_LITE__"', '"yes"'));

// on-device AI is off in the lite edition: its runtime is most of the size and is never requested
rmSync(join(OUT, "ort"), { recursive: true, force: true });
for (const f of readdirSync(join(OUT, "assets"))) if (/^ort-wasm.*\.wasm$/.test(f)) rmSync(join(OUT, "assets", f));

let bytes = 0;
let files = 0;
const walk = (dir: string) => {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p);
		else {
			bytes += st.size;
			files++;
		}
	}
};
walk(OUT);
console.log(`lite build: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
if (bytes > MAX_BYTES || files > MAX_FILES || !existsSync(join(OUT, "index.html"))) {
	console.error(`over Base44's limits (${MAX_BYTES / 1024 / 1024} MB, ${MAX_FILES} files) or no index.html: not uploaded`);
	process.exit(1);
}
if (dry) {
	console.log(`built in ${OUT} (--dry-run: not uploaded)`);
	process.exit(0);
}
run(["npx", "-y", "base44@latest", "site", "deploy", "-y", "--no-build"], PROJECT, process.env);
console.log("\x1b[33mpublic source must match what is hosted: run `bun run publish:source` (AGPL section 13)\x1b[0m");

function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
	const r = Bun.spawnSync(cmd, { cwd, env, stdout: "inherit", stderr: "inherit" });
	if (r.exitCode !== 0) {
		console.error(`failed: ${cmd.join(" ")}`);
		process.exit(r.exitCode ?? 1);
	}
}
