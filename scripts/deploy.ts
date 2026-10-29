// Static-frontend deploys: `bun run deploy vercel|cloudflare`. Uploads the PREBUILT shasta/dist, because neither
// platform can build the Scramjet engine (Rust nightly + wasm toolchain, scramjet/ is not in git).
// The static host has no Wisp and no Store API: point them at a real backend (the Docker image in ./Dockerfile):
//   SHASTA_BACKEND_URL=https://api.example.com  -> /api/* is proxied there (rewrite, no CORS needed)
//   VITE_WISP_URL=wss://api.example.com/wisp/   -> must be set when BUILDING (`bun run build`), it is baked in
// On Cloudflare Pages /wisp/ is proxied too (scripts/pages-worker.js), so VITE_WISP_URL is not needed there, and
// SHASTA_BACKEND_URL can be changed later in the Pages project settings without a rebuild.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "shasta/dist");
const target = process.argv[2];
const backend = process.env.SHASTA_BACKEND_URL?.replace(/\/+$/, "");
const project = process.env.SHASTA_PROJECT ?? "shasta";

if (target !== "vercel" && target !== "cloudflare") {
	console.error("usage: bun run deploy <vercel|cloudflare>   (SHASTA_BACKEND_URL, SHASTA_PROJECT optional)");
	process.exit(1);
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
if (!backend) {
	console.warn("\x1b[33mSHASTA_BACKEND_URL not set: the site will load but browsing and the Store need a backend.\x1b[0m");
}

// Same policy as server/server.mjs: isolation headers everywhere, /assets/ immutable, the rest revalidated.
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" };

const stage = join(ROOT, ".deploy", target);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(DIST, stage, { recursive: true });

if (target === "vercel") {
	const config = {
		cleanUrls: false,
		headers: [
			{ source: "/(.*)", headers: Object.entries(isolation).map(([key, value]) => ({ key, value })) },
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
	const headers = [
		`/*\n${Object.entries(isolation).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`,
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
	run(["bunx", "wrangler", "pages", "deploy", ".", "--project-name", project, "--branch", "main", "--commit-dirty=true"]);
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
