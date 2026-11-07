// The Shasta Lite build (shasta/src/lib/edition.ts, VITE_EDITION=lite), shared by every static host it is deployed to
// (`bun run deploy:base44`, `bun run deploy:vercel-lite`). Lite has no Shasta server of its own:
//   - browsing goes to the Wisp relay behind the Pages site (its worker forwards /wisp/ cross-origin; Wisp has no
//     Origin check);
//   - the Store, chat and the rest of /api go to the full site's backend across origins (lib/appApi.ts), which must
//     list the host in APP_ORIGINS (VPS /etc/shasta/shasta.env); always anonymous, so no staff sign-in;
//   - the ONNX Runtime wasm (on-device AI, 26 MB twice) is left out.
// The service worker adds COOP/COEP/DIP to Shasta's own pages (sw.js LITE_BUILD) for hosts that cannot send headers;
// on a host that can, the headers are simply already there.
import { assertNoShasuta } from "./shasutaGuard";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { adEnv } from "./adCodes";

export const ROOT = resolve(import.meta.dir, "../..");
export const FULL = "https://shasta-dtg.pages.dev";
/** The bunny.net relay (scripts/bunny-relay/relay.js, deployed by deploy-bunny.ts): Wisp + /api on bunny.run, a domain
 *  that is none of the ones above, so every Lite mirror still has a backend when a filter blocks pages.dev,
 *  edushasta.lol and vercel.app (seen on a school network 2026-11-03). */
export const BUNNY_RELAY = process.env.BUNNY_RELAY_HOST || "shasta-lite-relay.bunny.run";

/** Builds Lite into `out` (never shasta/dist, so the Cloudflare staged build is untouched); `statsId` = the host's
 *  own Umami website, never the full site's id from .env, so the hosts show up side by side. `base` = the folder the
 *  host serves it from ('/' unless the host gives it a sub-path, like jsDelivr); `extraEnv` = more build variables. */
export function buildLite(out: string, statsId: string, base = "/", extraEnv: Record<string, string> = {}) {
	for (const need of ["scramjet/packages/core/dist/scramjet.wasm", "shasta/public/adblock/engine.bin", "shasta/node_modules"]) {
		if (!existsSync(join(ROOT, need))) {
			console.error(`missing ${need}: run \`bun run build\` once first`);
			process.exit(1);
		}
	}
	const env: Record<string, string | undefined> = {
		...process.env,
		VITE_EDITION: "lite",
		// engine as /rt/* (vite.config.ts ENGINE_PATHS): a filter refused /scramjet/scramjet.js by its URL
		VITE_NEUTRAL_ENGINE: "1",
		// Two tunnels on two domains, tried in order (scramjetAdapter selectWisp/rotateWisp): a filter that blocks one
		// does not stop browsing on a Lite mirror. A static host cannot hold a websocket itself (Vercel rewrites,
		// Base44, jsDelivr), so a Lite mirror can never have its own /wisp/; these are the full site's.
		VITE_WISP_URL: "",
		// + our Vercel relay last (scripts/vercel-wisp: it pays per byte, so only when both above are blocked); a host
		// that runs no code (jsDelivr) then depends on no single domain
		// then the bunny.net relay (another domain again), Vercel's last
		VITE_WISP_URLS: [`wss://${new URL(FULL).host}/wisp/`, "wss://edushasta.lol/wisp/", `wss://${BUNNY_RELAY}/wisp/`, "wss://shasta-lite.vercel.app/wisp/"].join(","),
		// the Store/chat/live backend, tried in this order on a network error (lib/appApi.ts nextApiOrigin)
		VITE_API_ORIGINS: [FULL, "https://edushasta.lol", `https://${BUNNY_RELAY}`].join(","),
		// every now.gg proxy a Lite mirror may hand its games, tried in this order when its own is missing or blocked
		// (store/AppLauncher.tsx nowggBase -> lib/nowggProxy.ts pickNowggBase)
		VITE_NOWGG_BASES: [`${FULL.replace(/\/$/, "")}/nowgg`, "https://edushasta.lol/nowgg", "https://shasta-lite.vercel.app/nowgg", "https://shasta-lte.base44.app/functions/nowgg?p="].join(","),
		// share links name the full site, where a shared Store link actually opens; the canonical address is the
		// public domain, so search engines index edushasta.lol and treat the Lite mirrors as copies of it
		VITE_SHARE_ORIGIN: FULL,
		VITE_SITE_ORIGIN: process.env.VITE_SITE_ORIGIN || "https://edushasta.lol",
		VITE_STATS_URL: process.env.VITE_STATS_URL || "https://stats.176-100-37-63.sslip.io",
		VITE_STATS_WEBSITE_ID: statsId,
		// no adverts unless the host passes its own codes (adEnv): the root .env holds the Pages site's
		...adEnv(),
		...extraEnv,
	};
	// production rules: devtools shortcuts blocked, obfuscated chunks
	delete env.VITE_ALLOW_DEVTOOLS;
	delete env.VITE_OBFUSCATE;

	run(["bunx", "vite", "build", "--outDir", out, "--emptyOutDir", "--base", base], join(ROOT, "shasta"), env);

	assertNoShasuta(out, "the Lite build"); // the gaming mode is unreleased (scripts/lib/shasutaGuard.ts)

	const swPath = join(out, "sw.js");
	const sw = readFileSync(swPath, "utf8");
	if (!sw.includes('"__SHASTA_LITE__"')) {
		console.error("sw.js has no __SHASTA_LITE__ marker: cannot turn on isolation for Lite");
		process.exit(1);
	}
	writeFileSync(swPath, sw.replace('"__SHASTA_LITE__"', '"yes"'));

	// on-device AI is off in the lite edition: its runtime is most of the size and is never requested
	rmSync(join(out, "ort"), { recursive: true, force: true });
	for (const f of readdirSync(join(out, "assets"))) if (/^ort-wasm.*\.wasm$/.test(f)) rmSync(join(out, "assets", f));

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
	walk(out);
	console.log(`lite build: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
	if (!existsSync(join(out, "index.html"))) {
		console.error("lite build has no index.html");
		process.exit(1);
	}
	return { bytes, files };
}

export function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env) {
	const r = Bun.spawnSync(cmd, { cwd, env, stdout: "inherit", stderr: "inherit" });
	if (r.exitCode !== 0) {
		console.error(`failed: ${cmd.join(" ")}`);
		process.exit(r.exitCode ?? 1);
	}
}
