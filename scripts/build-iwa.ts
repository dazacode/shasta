// Package shasta/dist as an Isolated Web App (a signed web bundle): the installed Shasta app.
//
// Only an IWA gets raw sockets (the on-device Wisp relay) and <controlledframe> (the direct page engine, which runs
// every site). See docs/on-device-wisp.md.
//
//   bun run scripts/build-iwa.ts            stage + bundle + sign (needs wbn/wbn-sign via bunx)
//   bun run scripts/build-iwa.ts --stage    stage only (no network, no keys)
//
// Output: .iwa/stage/, .iwa/shasta.swbn (signed), .iwa/shasta.swbn-key.pem (the key = the app's identity).
// With IWA_BASE_URL=https://host/path/ (where the files will be hosted) the manifest gets an update_manifest_url and
// .iwa/publish/ holds update.json + shasta-<version>.swbn to upload there: what an administrator's policy installs
// from, and how Chrome finds updates. Raise shasta/package.json's version for every release.
//
// The bundle is the whole app, so this must run after `bun run build` (with VITE_APP_API_ORIGIN set, so the app can
// reach the Store and the AI mirror; that server needs APP_ORIGINS=isolated-app://<the id printed at the end>).

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "shasta/dist");
const OUT = join(ROOT, ".iwa");
const STAGE = join(OUT, "stage");
const KEY = join(OUT, "shasta.swbn-key.pem");
const BUNDLE = join(OUT, "shasta.wbn");
const SIGNED = join(OUT, "shasta.swbn");
const stageOnly = process.argv.includes("--stage");

const VERSION = JSON.parse(readFileSync(join(ROOT, "shasta/package.json"), "utf8")).version;
const PUBLISH = join(OUT, "publish");
const BASE_URL = (() => {
	const v = process.env.IWA_BASE_URL?.trim();
	if (!v) return "";
	if (!/^https:\/\/\S+$/.test(v)) {
		console.error("IWA_BASE_URL must be an https URL");
		process.exit(1);
	}
	return v.endsWith("/") ? v : v + "/";
})();

function fail(message: string): never {
	console.error(`\n\x1b[31m${message}\x1b[0m`);
	process.exit(1);
}

function run(cmd: string[], cwd = OUT) {
	console.log(`\n\x1b[36m> ${cmd.join(" ")}\x1b[0m`);
	const proc = Bun.spawnSync(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] });
	if (proc.exitCode !== 0) fail(`${cmd[0]} failed (exit ${proc.exitCode})`);
}

if (!existsSync(join(DIST, "index.html"))) fail("shasta/dist is missing: run `bun run build` first");

// --- stage ------------------------------------------------------------------------------------
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, ".well-known"), { recursive: true });
cpSync(DIST, STAGE, { recursive: true });

// A web bundle cannot use Cloudflare's `_headers`/`_redirects`/`_worker.js`; drop them so a Pages
// deploy is never mistaken for the bundle layout.
for (const f of ["_headers", "_redirects", "_worker.js", "_routes.json"]) {
	rmSync(join(STAGE, f), { force: true });
}
// The bundler's own copy of the ONNX Runtime wasm (26 MB) is never fetched: the AI worker points onnxruntime at
// /ort/ (ai/worker.ts, wasmPaths). In a bundle every byte is downloaded, so it goes.
for (const f of new Bun.Glob("assets/ort-wasm-*.wasm").scanSync({ cwd: STAGE })) rmSync(join(STAGE, f));

/**
 * The IWA manifest. `permissions_policy` is what unlocks Direct Sockets; without it `new TCPSocket()`
 * rejects with NotAllowedError. `cross-origin-isolated` is required for every IWA.
 *
 * The IWA CSP is imposed by the browser (`script-src 'self' 'wasm-unsafe-eval'`) and is the one
 * thing to measure before relying on this mode — see docs/on-device-wisp.md.
 */
const manifest = {
	// An IWA's manifest id must be "/" (otherwise it resolves to start_url and install fails).
	id: "/",
	name: "Shasta",
	short_name: "Shasta",
	version: VERSION,
	// "/", not "/index.html": `wbn --dir` stores index.html as a 301 to its directory, and an IWA bundle may
	// only answer 200 ("unsupported HTTP status code: 301"), so /index.html cannot be opened.
	start_url: "/",
	display: "standalone",
	scope: "/",
	theme_color: "#0b0b0f",
	background_color: "#0b0b0f",
	// Chrome refuses to install an IWA without a >=144px icon ("App is not installable").
	icons: [
		{ src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
		{ src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
	],
	// Chrome checks this for new versions (policy-installed apps); see IWA_BASE_URL above
	...(BASE_URL ? { update_manifest_url: `${BASE_URL}update.json` } : {}),
	permissions_policy: {
		"direct-sockets": ["self"],
		// <controlledframe>: loads a real site (its own CSP) for pages that need eval, which proxied pages cannot do here
		"controlled-frame": ["self"],
		"cross-origin-isolated": ["self"],
	},
};
writeFileSync(join(STAGE, ".well-known/manifest.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");

// No header file: Chrome applies an IWA's isolation headers (COOP/COEP/CORP) and CSP itself, and `wbn --dir`
// would never read one anyway.

const bytes = (() => {
	let total = 0;
	for (const f of new Bun.Glob("**/*").scanSync({ cwd: STAGE, onlyFiles: true })) total += statSync(join(STAGE, f)).size;
	return total;
})();
console.log(`staged ${STAGE} (${(bytes / 1024 / 1024).toFixed(1)} MiB, version ${VERSION})`);

if (stageOnly) {
	console.log("\n--stage: stopping here. Bundle with: bunx wbn --dir .iwa/stage --output .iwa/shasta.wbn");
	process.exit(0);
}

// --- sign -------------------------------------------------------------------------------------
// Ed25519, per the web-bundle integrity block. Kept in .iwa/ (gitignored): the key is the app's
// identity, so losing it means a new origin and fresh storage.
if (!existsSync(KEY)) {
	console.log(`generating an Ed25519 signing key at ${KEY}`);
	const key = Bun.spawnSync(["openssl", "genpkey", "-algorithm", "ed25519", "-out", KEY]);
	if (key.exitCode !== 0) fail("openssl is required to make a signing key (brew install openssl)");
}

// pinned: the bundle format and the integrity block must be ones Chrome reads (checked with Chrome 156)
run(["bunx", "wbn@0.0.9", "--dir", STAGE, "--output", BUNDLE]);
run(["bunx", "wbn-sign@0.3.3", "sign", BUNDLE, KEY, "-o", SIGNED]);

const info = Bun.spawnSync(["bunx", "wbn-sign@0.3.3", "info", SIGNED]).stdout.toString();
const id = /Web bundle ID:\s*([a-z0-9]+)/.exec(info)?.[1] ?? "(see `bunx wbn-sign info .iwa/shasta.swbn`)";

if (BASE_URL) {
	rmSync(PUBLISH, { recursive: true, force: true });
	mkdirSync(PUBLISH, { recursive: true });
	const file = `shasta-${VERSION}.swbn`;
	cpSync(SIGNED, join(PUBLISH, file));
	writeFileSync(join(PUBLISH, "update.json"), JSON.stringify({ versions: [{ version: VERSION, src: `${BASE_URL}${file}` }] }, null, 2) + "\n");
	console.log(`\nupload ${PUBLISH}/* to ${BASE_URL}`);
	console.log(`  people download: ${BASE_URL}${file}   (VITE_APP_BUNDLE_URL)`);
	console.log(`  administrators:  ${BASE_URL}update.json + id ${id}   (VITE_APP_UPDATE_MANIFEST_URL)`);
}

console.log(`\n\x1b[32msigned bundle: ${SIGNED}\x1b[0m`);
console.log(`app origin: isolated-app://${id}   (put it in the backend's APP_ORIGINS)`);
console.log("install: open the .swbn (ChromeOS 150+ / current Chrome installs it directly); older Chrome or a no-op: chrome://web-app-internals -> Install IWA from Signed Web Bundle");
