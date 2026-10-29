// Pre-publish checks: `bun run doctor`. Exits 1 on any ERROR; warnings are advice.
// Guards the rules in CLAUDE.md that are easy to break by accident and costly once public.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
const sh = (cmd: string[]) => {
	const r = Bun.spawnSync(cmd, { cwd: ROOT });
	return { ok: r.exitCode === 0, out: r.stdout.toString().trim() };
};

type Level = "ERROR" | "WARN" | "ok";
const results: { level: Level; msg: string }[] = [];
const report = (level: Level, msg: string) => results.push({ level, msg });
const check = (cond: boolean, level: Exclude<Level, "ok">, bad: string, good: string) =>
	report(cond ? "ok" : level, cond ? good : bad);

// --- Wisp / SSRF invariants (server/server.mjs)
const server = read("server/server.mjs");
if (!server) {
	// the public source snapshot ships the browser only; these invariants live in the backend
	report("ok", "server/ is not in this checkout: Wisp / SSRF checks skipped");
} else {
check(
	/allow_private_ips\s*=\s*false/.test(server) && /allow_loopback_ips\s*=\s*false/.test(server),
	"ERROR",
	"Wisp must set allow_private_ips and allow_loopback_ips = false (SSRF into host/LAN)",
	"Wisp blocks private and loopback addresses",
);
check(
	!/stream_limit_per_host\s*=/.test(server) || (process.env.WISP_IMPL ?? "upstream") === "shasta",
	"ERROR",
	"stream_limit_per_host is set while WISP_IMPL=upstream: wisp-js 0.4.1 crashes the process on it",
	"stream_limit_per_host is only used where it is safe (the shasta fork, WISP_IMPL=shasta)",
);
}

// --- Wisp relay fork (docs/on-device-wisp.md): pinned submodule, upstream stays the fallback
const wispPin = read("wisp.pin").trim();
const wispHead = sh(["git", "-C", "wisp", "describe", "--tags", "--always"]).out;
check(!!wispPin, "WARN", "wisp.pin is missing: the relay fork is unpinned", `wisp fork is pinned (${wispPin})`);
check(
	!wispHead || !wispPin || wispHead === wispPin,
	"WARN",
	`wisp/ is at ${wispHead} but wisp.pin says ${wispPin}`,
	"wisp/ matches wisp.pin",
);

// --- Repo hygiene: nothing secret or per-install may be tracked
const tracked = sh(["git", "ls-files"]).out.split("\n");
const leaked = tracked.filter((f) => /(^|\/)\.env($|\.)|\.db(-wal|-shm)?$|secret\.key$|\.e2e-store\//.test(f) && !/\.example$/.test(f));
check(leaked.length === 0, "ERROR", `tracked files that must stay local: ${leaked.join(", ")}`, "no secrets, databases or env files are tracked");
check(sh(["git", "status", "--porcelain"]).out === "", "WARN", "working tree has uncommitted changes", "working tree is clean");
const branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"]).out;
check(branch === "main", "WARN", `on branch ${branch}, not main`, "on main");

// --- Build output
const dist = join(ROOT, "shasta/dist/index.html");
check(existsSync(dist), "ERROR", "shasta/dist is missing: run `bun run build`", "shasta/dist exists");
if (existsSync(dist)) {
	const newest = sh(["git", "log", "-1", "--format=%ct", "--", "shasta/src", "shasta/public", "shasta/index.html"]).out;
	const stale = newest !== "" && statSync(dist).mtimeMs / 1000 < Number(newest);
	check(!stale, "WARN", "shasta/dist is older than the last commit touching shasta/src: rebuild", "dist is newer than the latest source commit");
}
check(
	process.env.VITE_ALLOW_DEVTOOLS !== "1",
	"WARN",
	"VITE_ALLOW_DEVTOOLS=1 is set in this shell: a build now would keep the devtools shortcuts",
	"devtools shortcut guard is on for production builds",
);

// --- Going public
check(["LICENSE", "LICENSE.md", "COPYING"].some((f) => existsSync(join(ROOT, f))), "WARN", "no LICENSE file: the project is AGPL-3.0 derived, a public host must offer the source", "LICENSE present");
const env = process.env;
// `bun run doctor --static`: checking a static frontend deploy (Pages/Vercel). TRUST_PROXY and CONTENT_ORIGIN are read
// by server.mjs only, so they belong on the backend host and say nothing about the static files.
const staticDeploy = process.argv.includes("--static");
check(!!env.VITE_SOURCE_URL, "WARN", "VITE_SOURCE_URL unset: a public host must offer its source (AGPL section 13); fine for a private deployment", "VITE_SOURCE_URL set (source offered in the app)");
if (staticDeploy) {
	report("ok", "TRUST_PROXY / CONTENT_ORIGIN: not applicable to a static frontend (set them on the backend host)");
} else {
check(env.TRUST_PROXY === "1", "WARN", "TRUST_PROXY is not 1: behind a reverse proxy every visitor shares one IP (rate limits, Wisp)", "TRUST_PROXY=1");
check(
	!!env.CONTENT_ORIGIN,
	"WARN",
	"CONTENT_ORIGIN unset: uploaded Store apps only load on *.apps.localhost, so they break on a public host (needs wildcard DNS)",
	"CONTENT_ORIGIN set",
);
}
// The client tries VITE_WISP_URLS, then VITE_WISP_URL, then the app's own /wisp/ (scramjetAdapter.ts defaultWispUrls).
const wispEndpoints = new Set([...(env.VITE_WISP_URLS ?? "").split(/[\s,]+/), env.VITE_WISP_URL ?? ""].filter(Boolean));
check(
	wispEndpoints.size > 0,
	"WARN",
	"only one Wisp endpoint (the app's own /wisp/): one block kills browsing; set VITE_WISP_URLS to relays on other hosts at build time",
	`${wispEndpoints.size + 1} Wisp endpoints (VITE_WISP_URLS/VITE_WISP_URL + the app's own /wisp/)`,
);
check(env.CROSS_ORIGIN_ISOLATION !== "0", "WARN", "cross-origin isolation is off: threaded wasm games will not run", "cross-origin isolation is on");

const color = { ERROR: "\x1b[31m", WARN: "\x1b[33m", ok: "\x1b[32m" } as const;
for (const { level, msg } of results) console.log(`${color[level]}${level.padEnd(5)}\x1b[0m ${msg}`);
const errors = results.filter((r) => r.level === "ERROR").length;
const warns = results.filter((r) => r.level === "WARN").length;
console.log(`\n${errors} error(s), ${warns} warning(s)`);
process.exit(errors ? 1 : 0);
