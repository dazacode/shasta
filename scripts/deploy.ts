// Static-frontend deploys: `bun run deploy vercel|cloudflare`. Uploads the PREBUILT shasta/dist, because neither
// platform can build the Scramjet engine (Rust nightly + wasm toolchain, scramjet/ is not in git).
// The static host has no Wisp and no Store API: point them at a real backend (the Docker image in ./Dockerfile):
//   SHASTA_BACKEND_URL=https://api.example.com  -> /api/* is proxied there (rewrite, no CORS needed)
//   VITE_WISP_URL=wss://api.example.com/wisp/   -> must be set when BUILDING (`bun run build`), it is baked in
// On Cloudflare Pages /wisp/ is proxied too (scripts/pages-worker.js), so VITE_WISP_URL is not needed there, and
// SHASTA_BACKEND_URL can be changed later in the Pages project settings without a rebuild.
//
// Cloudflare is staged first (owner decision 2026-10-29): `bun run deploy cloudflare` uploads to the `staging` branch
// (https://staging.<project>.pages.dev, behind Cloudflare Access with every other preview), the owner looks at it, and
// only after their go-ahead `bun run deploy cloudflare --prod` ships the SAME build to production (main). --prod
// refuses a dist that differs from the last staged one (`--force` overrides). `bun run deploy cloudflare --rollback
// [deployment id]` puts production back on an earlier deployment (default: the one before the current).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "shasta/dist");
const target = process.argv[2];
const project = process.env.SHASTA_PROJECT ?? "shasta";
const prod = process.argv.includes("--prod");
const force = process.argv.includes("--force");
const STAGED = join(ROOT, ".deploy", "staged.json");
// --prod ships against the backend staging was checked with, unless one is given
const stagedBackend = prod && existsSync(STAGED) ? JSON.parse(readFileSync(STAGED, "utf8")).backend : undefined;
let backend = (process.env.SHASTA_BACKEND_URL ?? stagedBackend)?.replace(/\/+$/, "");
const PAGES_HOST = process.env.SHASTA_PAGES_HOST ?? "shasta-dtg.pages.dev"; // Cloudflare picks the subdomain when the project is created

if (target !== "vercel" && target !== "cloudflare") {
	console.error("usage: bun run deploy <vercel|cloudflare> [--prod [--force] | --rollback [id]]   (SHASTA_BACKEND_URL, SHASTA_PROJECT optional)");
	process.exit(1);
}
if (target === "cloudflare" && process.argv.includes("--rollback")) {
	await rollback(process.argv.slice(3).find((a) => !a.startsWith("--")));
	process.exit(0);
}
if (!existsSync(join(DIST, "index.html"))) {
	console.error("shasta/dist is missing: run `bun run build` first");
	process.exit(1);
}
// The links on shasta://get-app are baked in at build time; a dist built without them (e.g. `cd shasta && bun run
// build`, which does not load the root .env) hides the download buttons.
for (const name of ["VITE_APP_BUNDLE_URL", "VITE_APP_UPDATE_MANIFEST_URL"]) {
	const value = process.env[name];
	if (!value) continue;
	const built = [...new Bun.Glob("assets/*.js").scanSync({ cwd: DIST })].some((f) => readFileSync(join(DIST, f), "utf8").includes(value));
	if (!built) {
		console.error(`shasta/dist was built without ${name}: rebuild from the root (\`bun run build\`) before deploying`);
		process.exit(1);
	}
}
// Preview deployments (staging) have no SHASTA_BACKEND_URL in the Pages settings, so without a baked backend
// staging loads with browsing and the Store dead. Ask the VPS for its current quick tunnel instead.
if (!backend && target === "cloudflare" && !prod) {
	backend = vpsTunnel();
	if (backend) console.log(`backend: ${backend} (the VPS's current tunnel)`);
	else if (process.env.SHASTA_DRY_RUN !== "1") {
		console.error("staging needs a backend: set SHASTA_BACKEND_URL (could not read the tunnel with `ssh shasta`)");
		process.exit(1);
	}
}
if (!backend) {
	console.warn("\x1b[33mSHASTA_BACKEND_URL not set: the site will load but browsing and the Store need a backend.\x1b[0m");
}

function vpsTunnel(): string | undefined {
	const ssh = Bun.spawnSync(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "shasta", "curl -s 127.0.0.1:20241/quicktunnel"], { stderr: "ignore" });
	try {
		const host = JSON.parse(ssh.stdout.toString()).hostname;
		return typeof host === "string" && host ? `https://${host}` : undefined;
	} catch {
		return undefined;
	}
}

// Same policy as server/server.mjs: isolation headers everywhere, /assets/ immutable, the rest revalidated.
// Document-Isolation-Policy is the part that still isolates the app when it is embedded in a non-COI page such
// as a Google Site (docs/google-sites-embed.md); Chrome 137+ desktop honours it, other browsers ignore it.
const isolation = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "credentialless",
	"Document-Isolation-Policy": "isolate-and-credentialless",
};

const stage = join(ROOT, ".deploy", target);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(DIST, stage, { recursive: true });

if (target === "vercel") {
	const config = {
		cleanUrls: false,
		headers: [
			{
				source: "/(.*)",
				headers: [
					...Object.entries(isolation).map(([key, value]) => ({ key, value })),
					// same Google-embed allowance as the Cloudflare `_headers` block (see above)
					{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://sites.google.com https://*.gstatic.com https://*.googleusercontent.com" },
				],
			},
			{ source: "/((?!assets/).*)", headers: [{ key: "Cache-Control", value: "no-cache" }] },
			{ source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
			{ source: "/sw.js", headers: [{ key: "Service-Worker-Allowed", value: "/" }] },
		],
		rewrites: backend ? [{ source: "/api/:path*", destination: `${backend}/api/:path*` }, { source: "/ai-models/:path*", destination: `${backend}/ai-models/:path*` }] : [],
	};
	writeFileSync(join(stage, "vercel.json"), JSON.stringify(config, null, 2));
	const scope = process.env.VERCEL_SCOPE ?? "dazaseals-projects";
	run(["vercel", "link", "--yes", "--project", project, "--scope", scope]);
	run(["vercel", "deploy", "--prod", "--yes", "--scope", scope]);
} else {
	// ONE `/*` block, not two. Cloudflare Pages keys header rules by source pattern, and a second `/*` block
	// REPLACES the first: splitting the isolation headers out silently dropped COOP/COEP, so production served
	// no cross-origin isolation and threaded-wasm games broke. Keep every `/*` header in this single block.
	// frame-ancestors lets a public Google Site embed the app (docs/google-sites-embed.md); the whole ancestor
	// chain must be named (sites.google.com -> *.gstatic.com -> *.googleusercontent.com) and `'self'` keeps our
	// own same-origin frames. The crawler hints below the isolation headers are for school-filter classifiers
	// (docs/unblocking.md): advertise the sitemap and never let the crawler skip the SPA.
	const headers = [
		[
			"/*",
			...Object.entries(isolation).map(([k, v]) => `  ${k}: ${v}`),
			"  X-Robots-Tag: all",
			'  Link: </sitemap.xml>; rel="sitemap"',
			"  Content-Security-Policy: frame-ancestors 'self' https://sites.google.com https://*.gstatic.com https://*.googleusercontent.com",
		].join("\n"),
		"/assets/*\n  Cache-Control: public, max-age=31536000, immutable",
		"/sw.js\n  Service-Worker-Allowed: /\n  Cache-Control: no-cache",
	];
	writeFileSync(join(stage, "_headers"), headers.join("\n\n") + "\n");
	// Pages cannot proxy `_redirects` to another host, so /api, /wisp (websocket) and /ai-models go through a
	// small worker (scripts/pages-worker.js). It also serves the files over Pages' 25 MiB limit from jsdelivr.
	const oversize = await moveOversizeFiles(stage);
	const worker = readFileSync(join(ROOT, "scripts/pages-worker.js"), "utf8")
		.replace('"__SHASTA_BACKEND__"', JSON.stringify(backend ?? ""))
		.replace('JSON.parse("__SHASTA_OVERSIZE__")', JSON.stringify(oversize));
	writeFileSync(join(stage, "_worker.js"), worker);
	const include = ["/api/*", "/wisp/*", "/ai-models/*", "/healthz", ...Object.keys(oversize)];
	writeFileSync(join(stage, "_routes.json"), JSON.stringify({ version: 1, include, exclude: [] }, null, 2));
	if (process.env.SHASTA_DRY_RUN === "1") {
		console.log(`staged in ${stage} (SHASTA_DRY_RUN=1: not uploaded)`);
		process.exit(0);
	}
	const built = distHash();
	if (prod) {
		const staged = existsSync(STAGED) ? JSON.parse(readFileSync(STAGED, "utf8")) : null;
		if (staged?.hash !== built && !force) {
			console.error(
				staged
					? `shasta/dist changed since it was staged (${staged.at}): stage it again (\`bun run deploy cloudflare\`), have it checked, then --prod`
					: "nothing staged yet: `bun run deploy cloudflare` first, have it checked, then --prod",
			);
			process.exit(1);
		}
	}
	const branch = prod ? "main" : "staging";
	run(["bunx", "wrangler", "pages", "deploy", ".", "--project-name", project, "--branch", branch, "--commit-dirty=true"]);
	if (prod) {
		console.log(`\nproduction: https://${PAGES_HOST}  (undo: bun run deploy cloudflare --rollback)`);
		console.log("\x1b[33mpublic source must match what is hosted: run `bun run publish:source` now (AGPL section 13)\x1b[0m");
	} else {
		writeFileSync(STAGED, JSON.stringify({ hash: built, at: new Date().toISOString(), backend: backend ?? null }, null, 2));
		console.log(`\nstaging: https://staging.${PAGES_HOST}  (private; ship it with: bun run deploy cloudflare --prod)`);
	}
}

/** Content hash of shasta/dist, so --prod can tell whether it is the build that was staged. */
function distHash() {
	const hash = createHash("sha256");
	for (const file of [...new Bun.Glob("**/*").scanSync({ cwd: DIST, dot: true })].sort()) {
		hash.update(file + "\0");
		hash.update(readFileSync(join(DIST, file)));
	}
	return hash.digest("hex");
}

/** Points production back at an earlier production deployment (Cloudflare keeps them all). */
async function rollback(id?: string) {
	const token = Bun.spawnSync(["bunx", "wrangler", "auth", "token"], { cwd: ROOT }).stdout.toString().trim().split("\n").pop();
	const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "8552691187cf71a442505a28a8e80fa0";
	const api = (path: string, init?: RequestInit) =>
		fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}${path}`, {
			...init,
			headers: { Authorization: `Bearer ${token}` },
		}).then((r) => r.json() as Promise<{ success: boolean; errors: unknown[]; result: any }>);
	const list = await api("/deployments?env=production");
	if (!list.success) throw new Error(`listing deployments failed: ${JSON.stringify(list.errors)}`);
	const deployments = list.result as { id: string; short_id: string; created_on: string; url: string }[];
	const target = id ? deployments.find((d) => d.id === id || d.short_id === id) : deployments[1];
	if (!target) {
		console.error(id ? `no production deployment ${id}` : "no earlier production deployment");
		for (const d of deployments.slice(0, 10)) console.error(`  ${d.short_id}  ${d.created_on}  ${d.url}`);
		process.exit(1);
	}
	const done = await api(`/deployments/${target.id}/rollback`, { method: "POST" });
	if (!done.success) throw new Error(`rollback failed: ${JSON.stringify(done.errors)}`);
	console.log(`production is back on ${target.short_id} (${target.created_on})`);
}

/**
 * Removes files over Pages' 25 MiB limit from the stage and returns where the worker fetches them instead. Only
 * ONNX Runtime files are known (they are published on npm, so jsdelivr has them); the jsdelivr copy must hash the
 * same as ours, otherwise the deploy stops rather than serve a different engine.
 */
async function moveOversizeFiles(dir: string): Promise<Record<string, string>> {
	const LIMIT = 25 * 1024 * 1024;
	const ortDir = join(ROOT, "shasta/node_modules/onnxruntime-web");
	const ortVersion = JSON.parse(readFileSync(join(ortDir, "package.json"), "utf8")).version;
	const ortByHash = new Map<string, string>();
	for (const name of readdirSync(join(ortDir, "dist"))) if (name.endsWith(".wasm")) ortByHash.set(sha256(readFileSync(join(ortDir, "dist", name))), name);
	const out: Record<string, string> = {};
	const checked = new Map<string, string>();
	for (const rel of new Bun.Glob("**/*").scanSync({ cwd: dir, dot: true })) {
		const file = join(dir, rel);
		if (statSync(file).size <= LIMIT) continue;
		const name = ortByHash.get(sha256(readFileSync(file)));
		if (!name) {
			console.error(`${rel} is over Pages' 25 MiB file limit and is not a known ONNX Runtime file`);
			process.exit(1);
		}
		const upstream = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/${name}`;
		if (!checked.has(upstream)) {
			const r = await fetch(upstream);
			const hash = r.ok ? sha256(new Uint8Array(await r.arrayBuffer())) : `HTTP ${r.status}`;
			checked.set(upstream, hash);
		}
		if (checked.get(upstream) !== sha256(readFileSync(file))) {
			console.error(`${upstream} does not match ${rel} (${checked.get(upstream)}); not deploying`);
			process.exit(1);
		}
		rmSync(file);
		out["/" + rel.split(sep).join("/")] = upstream;
		console.log(`${rel}: over 25 MiB, served from ${upstream}`);
	}
	return out;
}

function sha256(data: Uint8Array) {
	return createHash("sha256").update(data).digest("hex");
}

function run(cmd: string[]) {
	console.log(`\n\x1b[36m> ${cmd.join(" ")}\x1b[0m`);
	const r = Bun.spawnSync(cmd, { cwd: stage, stdio: ["inherit", "inherit", "inherit"] });
	if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);
}
