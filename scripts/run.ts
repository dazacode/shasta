// One entry point for dev / start / build. Builds only what is missing or stale.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRAMJET = join(ROOT, "scramjet");
const SHASTA = join(ROOT, "shasta");
const SERVER = join(ROOT, "server");
const PORT = process.env.PORT ?? "8080";

// scramjet's build script needs bash >= 4 and cargo; macOS ships bash 3.2.
const env = {
	...process.env,
	PATH: `/opt/homebrew/bin:${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
};

function fail(msg: string): never {
	console.error(`\n\x1b[31m${msg}\x1b[0m`);
	process.exit(1);
}

function need(cmd: string, hint: string) {
	if (!Bun.which(cmd, { PATH: env.PATH })) fail(`Missing \`${cmd}\`. ${hint}`);
}

async function run(label: string, cmd: string[], cwd: string, extra: Record<string, string> = {}, tolerate = false) {
	console.log(`\n\x1b[36m> ${label}\x1b[0m`);
	const proc = Bun.spawn(cmd, { cwd, env: { ...env, ...extra }, stdio: ["inherit", "inherit", "inherit"] });
	const code = await proc.exited;
	if (code !== 0 && !tolerate) fail(`${label} failed (exit ${code})`);
}

/** Newest mtime under dir (ignoring node_modules/dist), in ms. */
function newest(dir: string): number {
	let max = 0;
	for (const f of new Bun.Glob("**/*").scanSync({ cwd: dir, onlyFiles: true })) {
		if (f.startsWith("node_modules/") || f.startsWith("dist/")) continue;
		max = Math.max(max, statSync(join(dir, f)).mtimeMs);
	}
	return max;
}

const PATCHES = join(ROOT, "patches");
/** The engine version is the submodule's commit, and nothing else. */
const ENGINE_STAMP = join(ROOT, "data/engine-built");

function engineCommit(): string {
	const proc = Bun.spawnSync(["git", "-C", SCRAMJET, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) fail("scramjet/ is missing or is not a git checkout. Run: git submodule update --init");
	return proc.stdout.toString().trim();
}

function engineLabel(): string {
	const proc = Bun.spawnSync(["git", "-C", SCRAMJET, "describe", "--tags", "--always"], { stdout: "pipe", stderr: "pipe" });
	return proc.exitCode === 0 ? proc.stdout.toString().trim() : engineCommit().slice(0, 10);
}

/** The bundles exist (regardless of which commit they came from). */
const engineArtifacts = () =>
	existsSync(join(SCRAMJET, "packages/core/dist/scramjet.wasm")) &&
	existsSync(join(SCRAMJET, "packages/core/dist/scramjet.js")) &&
	existsSync(join(SCRAMJET, "packages/controller/dist/controller.sw.js"));

/** Built *and* built from the commit that is checked out right now. */
const engineBuilt = () => engineArtifacts() && readStamp() === engineCommit();

function readStamp(): string | null {
	try {
		return readFileSync(ENGINE_STAMP, "utf8").trim();
	} catch {
		return null;
	}
}

function stampEngine() {
	mkdirSync(join(ROOT, "data"), { recursive: true });
	writeFileSync(ENGINE_STAMP, `${engineCommit()}\n`);
}

/**
 * Our Scramjet changes are commits on the fork's `shasta` branch, so normally there is nothing
 * to apply. `patches/` is the fallback for a checkout of a plain upstream commit (see
 * docs/engine.md) and is applied only when the tree does not already contain it.
 */
async function ensurePatches(): Promise<void> {
	if (!existsSync(PATCHES)) return;
	for (const name of [...new Bun.Glob("*.patch").scanSync({ cwd: PATCHES })].sort()) {
		const file = join(PATCHES, name);
		const git = (...args: string[]) => Bun.spawnSync(["git", "-C", SCRAMJET, ...args, file], { stdout: "ignore", stderr: "pipe" });
		if (git("apply", "--reverse", "--check").exitCode === 0) continue;
		const check = git("apply", "--check");
		if (check.exitCode !== 0) fail(`Patch ${name} applies neither way to scramjet/ (the engine moved underneath it?):\n${check.stderr.toString()}`);
		git("apply");
		console.log(`applied ${name}`);
	}
}

async function ensureEngine(force: boolean) {
	await ensurePatches();
	const commit = engineCommit();
	if (!force && engineBuilt()) return;
	console.log(`Building the Scramjet engine at ${engineLabel()} (first run takes a few minutes)...`);
	need("pnpm", "Install with: npm i -g pnpm@10.12.1");
	need("cargo", "Install Rust: brew install rustup && rustup toolchain install nightly --target wasm32-unknown-unknown -c rust-src");
	need("wasm-bindgen", "Install with: cargo install wasm-bindgen-cli --version 0.2.105 --locked");
	need("wasm-snip", "Install with: cargo install --git https://github.com/r58Playz/wasm-snip --locked");
	need("wasm-opt", "Install with: brew install binaryen");
	const core = join(SCRAMJET, "packages/core");
	await run("scramjet: pnpm i", ["pnpm", "i", "--frozen-lockfile"], SCRAMJET);
	await run("scramjet: rewriter (wasm)", ["pnpm", "rewriter:build"], core, { RELEASE: "1" });
	// exits non-zero on known, harmless .d.ts errors; bundles are still emitted
	await run("scramjet: bundles", ["pnpm", "build"], core, {}, true);
	if (!engineArtifacts()) fail("Scramjet build did not produce its bundles. See the output above.");
	stampEngine();
	console.log(`engine ready: ${commit.slice(0, 10)} (${engineLabel()})`);
}

async function ensureDeps() {
	// wisp/: Shasta bundles files from it (the in-page relay), and they import its own dependencies
	for (const dir of [SHASTA, SERVER, join(ROOT, "wisp")]) {
		// the public source snapshot ships only the browser (server/ absent): skip what is not here
		if (!existsSync(dir)) continue;
		if (!existsSync(join(dir, "node_modules"))) await run(`bun install (${dir.split("/").pop()})`, ["bun", "install"], dir);
	}
}

/** The Store backend is a separate program and is not in every checkout (the public source snapshot omits it). */
function needServer() {
	if (!existsSync(SERVER)) fail("This checkout has no server/ (the Store backend runs on our servers). Use `bun run build` here, or the full repository.");
}

const ADBLOCK_ENGINE = join(SHASTA, "public/adblock/engine.bin");
const ADBLOCK_MAX_AGE_DAYS = Number(process.env.ADBLOCK_MAX_AGE_DAYS ?? 3);

/** The ad blocker's filter lists change daily: rebuild the engine when it is missing or a few days old. */
async function ensureAdblock(force: boolean) {
	const age = existsSync(ADBLOCK_ENGINE) ? (Date.now() - statSync(ADBLOCK_ENGINE).mtimeMs) / 86_400_000 : Infinity;
	const extraChanged = existsSync(ADBLOCK_ENGINE) && statSync(join(ROOT, "scripts/adblock-extra.txt")).mtimeMs > statSync(ADBLOCK_ENGINE).mtimeMs;
	if (!force && !extraChanged && age < ADBLOCK_MAX_AGE_DAYS) return;
	// offline or GitHub down: keep the engine we have (a build without one still works, just without blocking)
	await run("adblock: filter lists", ["bun", "scripts/build-adblock.ts"], ROOT, {}, existsSync(ADBLOCK_ENGINE));
}

/**
 * The retro emulator Store apps (apps/emu-*, published by the server at start): rebuilt when one is missing or older
 * than the catalog/shell/build script. A first build downloads ~250 MB (cached in .cache/emulators); offline, the apps
 * we have stay. EMULATORS=0 skips them.
 */
async function ensureEmulators(force: boolean) {
	if (process.env.EMULATORS === "0") return;
	const sources = Math.max(newest(join(ROOT, "scripts/emulators")), statSync(join(ROOT, "scripts/build-emulators.ts")).mtimeMs);
	const built = new Bun.Glob("emu-*/shasta.json").scanSync({ cwd: join(ROOT, "apps") });
	let oldest = Infinity;
	let count = 0;
	for (const f of built) {
		oldest = Math.min(oldest, statSync(join(ROOT, "apps", f)).mtimeMs);
		count++;
	}
	const { APPS } = await import("./emulators/catalog");
	if (!force && count >= APPS.length && oldest >= sources) return;
	await run("emulators: Store apps", ["bun", "scripts/build-emulators.ts"], ROOT, {}, count > 0);
}

async function ensureShasta(force: boolean) {
	await ensureAdblock(force);
	await ensureEmulators(force);
	const out = join(SHASTA, "dist/index.html");
	const stale =
		!existsSync(out) ||
		statSync(out).mtimeMs < Math.max(newest(join(SHASTA, "src")), newest(join(SHASTA, "public")), statSync(join(SHASTA, "index.html")).mtimeMs) ||
		statSync(out).mtimeMs < statSync(join(SCRAMJET, "packages/core/dist/scramjet.wasm")).mtimeMs ||
		statSync(out).mtimeMs < statSync(join(SCRAMJET, "packages/core/dist/scramjet.js")).mtimeMs;
	if (force || stale) await run("shasta: build", ["bun", "run", "build"], SHASTA);
}

const mode = process.argv[2];

if (mode === "build") {
	await ensureEngine(true);
	await ensureDeps();
	await ensureShasta(true);
	console.log("\nbuild ok -> shasta/dist");
} else if (mode === "start") {
	needServer();
	await ensureEngine(false);
	await ensureDeps();
	await ensureShasta(false);
	console.log(`\nShasta -> http://localhost:${PORT}`);
	const server = Bun.spawn(["bun", "server.mjs"], { cwd: SERVER, env: { ...env, PORT }, stdio: ["inherit", "inherit", "inherit"] });
	for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.kill());
	process.exit(await server.exited);
} else if (mode === "share") {
	// Production server + a free Cloudflare quick tunnel (no account, no domain): a public https URL for friends.
	// Uploaded Store apps do not load through it (their *.apps.localhost hosts only exist on this machine).
	needServer();
	need("cloudflared", "Install with: brew install cloudflared");
	await ensureEngine(false);
	await ensureDeps();
	await ensureShasta(false);
	const server = Bun.spawn(["bun", "server.mjs"], { cwd: SERVER, env: { ...env, PORT, TRUST_PROXY: "1" }, stdio: ["inherit", "inherit", "inherit"] });
	const tunnel = Bun.spawn(["cloudflared", "tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { env, stdout: "ignore", stderr: "pipe" });
	const stop = () => {
		server.kill();
		tunnel.kill();
	};
	for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, stop);
	for (let i = 0; i < 50; i++) {
		if (await fetch(`http://localhost:${PORT}/healthz`).then((r) => r.ok, () => false)) break;
		await Bun.sleep(200);
	}
	// cloudflared logs to stderr; the URL appears once the tunnel is registered. Keep draining so it never blocks.
	void (async () => {
		let shown = false;
		const decoder = new TextDecoder();
		for await (const chunk of tunnel.stderr) {
			const url = !shown && decoder.decode(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
			if (!url) continue;
			shown = true;
			console.log(`\n\x1b[32mShare this link: ${url}\x1b[0m\n(works while this window stays open; Ctrl+C stops it; the link changes each run)\n`);
		}
	})();
	await Promise.race([server.exited, tunnel.exited]);
	stop();
} else if (mode === "pages-backend") {
	// The backend for the PRIVATE Cloudflare Pages deployment (docs/deployment.md), run on this machine: production
	// server + a quick tunnel, then the Pages site is redeployed pointing at the tunnel. The tunnel address is public,
	// so the server refuses everything without BACKEND_KEY, which only the Pages worker sends (a Pages secret).
	// Works while this command runs; the tunnel address changes each run (the redeploy follows it).
	needServer();
	need("cloudflared", "Install with: brew install cloudflared");
	await ensureEngine(false);
	await ensureDeps();
	await ensureShasta(false);
	const keyFile = join(ROOT, "data/backend.key");
	if (!existsSync(keyFile)) {
		mkdirSync(join(ROOT, "data"), { recursive: true });
		writeFileSync(keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
	}
	chmodSync(keyFile, 0o600);
	const key = readFileSync(keyFile, "utf8").trim();
	const server = Bun.spawn(["bun", "server.mjs"], { cwd: SERVER, env: { ...env, PORT, TRUST_PROXY: "1", BACKEND_KEY: key }, stdio: ["inherit", "inherit", "inherit"] });
	const tunnel = Bun.spawn(["cloudflared", "tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { env, stdout: "ignore", stderr: "pipe" });
	const stop = () => {
		server.kill();
		tunnel.kill();
	};
	for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, stop);
	const url = await new Promise<string>((resolve) => {
		void (async () => {
			const decoder = new TextDecoder();
			let found = "";
			for await (const chunk of tunnel.stderr) {
				const m = !found && decoder.decode(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
				if (m) resolve((found = m));
			}
		})();
	});
	for (let i = 0; i < 60; i++) {
		if (await fetch(`${url}/healthz`).then((r) => r.ok, () => false)) break;
		await Bun.sleep(1000);
	}
	console.log(`\ntunnel: ${url} (refuses requests without the backend key)`);
	const project = process.env.SHASTA_PROJECT ?? "shasta";
	const secret = Bun.spawn(["bunx", "wrangler", "pages", "secret", "put", "SHASTA_BACKEND_KEY", "--project-name", project], { cwd: ROOT, env, stdin: new Blob([key]), stdout: "inherit", stderr: "inherit" });
	if ((await secret.exited) !== 0) fail("could not store SHASTA_BACKEND_KEY in the Pages project");
	await run("deploy the Pages site against this backend", ["bun", "scripts/deploy.ts", "cloudflare"], ROOT, { SHASTA_BACKEND_URL: url });
	console.log(`\n\x1b[32mPrivate site connected: https://${project === "shasta" ? "shasta-dtg" : project}.pages.dev (Ctrl+C disconnects it)\x1b[0m\n`);
	await Promise.race([server.exited, tunnel.exited]);
	stop();
} else if (mode === "dev") {
	needServer();
	await ensureEngine(false);
	await ensureDeps();
	// Vite proxies /wisp to this server, so the frontend's same-origin default URL just works.
	const wisp = Bun.spawn(["bun", "server.mjs"], { cwd: SERVER, env: { ...env, PORT: "8080" }, stdio: ["inherit", "inherit", "inherit"] });
	const vite = Bun.spawn(["bun", "run", "dev", "--host", "localhost"], { cwd: SHASTA, env, stdio: ["inherit", "inherit", "inherit"] });
	const stop = () => {
		wisp.kill();
		vite.kill();
	};
	for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, stop);
	await Promise.race([wisp.exited, vite.exited]);
	stop();
} else {
	fail("usage: bun scripts/run.ts <dev|start|build|share|pages-backend>");
}
