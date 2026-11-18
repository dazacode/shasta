// `bun run mirrors:deploy`: builds and deploys the "shasta-mirrors" Worker (scripts/mirrors/worker.js) with Wrangler.
// `--secret` also copies the backend key from the VPS into the Worker (ssh -> wrangler stdin, never printed).
// The Worker gets no routes from here: the zone's one `*/*` route sends it the custom hostnames (a route naming a
// FreeDNS host is refused, "must include zone name"), with no-Worker routes keeping edushasta.lol, www and origin off
// it. Those routes, the fallback origin and the custom hostnames are set in the zone (docs/notes/deploy.md "FreeDNS mirrors").
// Needs `wrangler login` (or CLOUDFLARE_API_TOKEN) and, for --secret, `ssh shasta` with sudo.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIRRORS } from "./hosts";

const ROOT = join(import.meta.dir, "../..");
const OUT = join(ROOT, ".deploy/mirrors");
const ACCOUNT = "8552691187cf71a442505a28a8e80fa0";
const BACKEND = "https://origin.edushasta.lol";

mkdirSync(OUT, { recursive: true });
// the static files come from the public site, which serves its own oversized files: no OVERSIZE map here
const pages = readFileSync(join(ROOT, "scripts/pages-worker.js"), "utf8")
	.replace('"__SHASTA_BACKEND__"', JSON.stringify(BACKEND))
	.replace('JSON.parse("__SHASTA_OVERSIZE__")', "{}");
if (pages.includes("__SHASTA_")) throw new Error("pages-worker.js placeholders changed: update scripts/mirrors/deploy.ts");
writeFileSync(join(OUT, "pages-worker.js"), pages);
copyFileSync(join(import.meta.dir, "worker.js"), join(OUT, "worker.js"));
writeFileSync(
	join(OUT, "wrangler.json"),
	JSON.stringify(
		{
			name: "shasta-mirrors",
			main: "worker.js",
			account_id: ACCOUNT,
			compatibility_date: "2026-11-01",
			workers_dev: false,
		},
		null,
		2,
	),
);

const wrangler = (args: string[], input?: Buffer) => {
	const r = spawnSync("bunx", ["wrangler", ...args, "--config", join(OUT, "wrangler.json")], { cwd: OUT, input, stdio: [input ? "pipe" : "inherit", "inherit", "inherit"] });
	if (r.status !== 0) process.exit(r.status ?? 1);
};

wrangler(["deploy"]);

if (process.argv.includes("--secret")) {
	const key = spawnSync("ssh", ["shasta", "sudo grep -m1 '^BACKEND_KEY=' /etc/shasta/shasta.env | cut -d= -f2-"], { stdio: ["ignore", "pipe", "inherit"] });
	const value = key.stdout.toString().trim();
	if (key.status !== 0 || !value) throw new Error("could not read BACKEND_KEY from the VPS");
	wrangler(["secret", "put", "SHASTA_BACKEND_KEY"], Buffer.from(value));
}
console.log(`shasta-mirrors deployed for ${MIRRORS.length} mirrors`);
