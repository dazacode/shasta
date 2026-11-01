#!/usr/bin/env bun
/**
 * Vendor + prepare a self-hosted x8rr/stratus-api (and its mail service, malq) so the cloud games
 * stop depending on opium's public mirrors.
 *
 *   bun scripts/stratus-api.ts            # clone + install + prepare (no servers started)
 *   bun scripts/stratus-api.ts --check    # only report what is present
 *
 * After this, run the two services and import against them:
 *   cd vendor/malq        && bun src/main.ts          # 127.0.0.1:4400
 *   cd vendor/stratus-api/api && node api.js          # 127.0.0.1:3001
 *   bun scripts/import-opium-cloud.ts --api-base http://127.0.0.1:3001 --api-key sk_live_edushasta --catalog https://raw.../cloud.json
 *
 * The player reads window.__OPIUM_API__ ({base, prefix:"cloud/v1", key, catalog}); packages bake it in.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const vendor = path.join(root, "vendor");
const STRATUS = path.join(vendor, "stratus-api");
const MALQ = path.join(vendor, "malq");
const API_KEY = process.env.STRATUS_API_KEY || "sk_live_edushasta";
const checkOnly = process.argv.includes("--check");

const sh = (cmd: string[], cwd?: string, tolerate = false) => {
	console.log(`  $ ${cmd.join(" ")}`);
	const p = Bun.spawnSync(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] });
	if (p.exitCode !== 0 && !tolerate) throw new Error(`${cmd.join(" ")} failed (${p.exitCode})`);
};

const clone = (url: string, dir: string) => {
	if (existsSync(path.join(dir, ".git"))) return console.log(`  · ${path.basename(dir)} already present`);
	if (checkOnly) return console.log(`  · ${path.basename(dir)} MISSING (run without --check)`);
	mkdirSync(vendor, { recursive: true });
	sh(["git", "clone", "--depth", "1", url, dir]);
};

console.log("stratus-api self-host setup");
clone("https://github.com/x8rr/stratus-api", STRATUS);
clone("https://github.com/VillainsRule/malq", MALQ);

if (!checkOnly) {
	// stratus-api's api/ is a tiny express+ws server; its account core lives in core.cjs
	const apiDir = path.join(STRATUS, "api");
	for (const dir of [apiDir, MALQ]) {
		if (!existsSync(path.join(dir, "node_modules"))) {
			console.log(`  install deps in ${path.basename(dir)}`);
			sh(Bun.which("bun") ? ["bun", "install"] : ["npm", "install"], dir, true);
		}
	}

	// the API has no /games route: it serves public/ statically, so drop the catalogue there
	const cloud = path.join(STRATUS, "cloud.json");
	if (existsSync(cloud)) {
		copyFileSync(cloud, path.join(apiDir, "public", "cloud.json"));
		console.log(`  · published cloud.json (${JSON.parse(readFileSync(cloud, "utf8")).length} games) at /cloud.json`);
	}

	// hand this key to the player/importer (x-api-key). NB: the shipped sites.json has a trailing
	// `// comment` that JSON.parse rejects, so strip comments before parsing.
	const sites = path.join(apiDir, "sites.json");
	try {
		const cfg = JSON.parse(readFileSync(sites, "utf8").replace(/^\s*\/\/.*$/gm, ""));
		cfg.sites = cfg.sites || {};
		cfg.sites.main = { ...(cfg.sites.main || {}), api_key: API_KEY, enabled: true };
		writeFileSync(sites, JSON.stringify(cfg, null, 2));
		console.log(`  · sites.json api_key = ${API_KEY}`);
	} catch (e) {
		console.log(`  ! could not update sites.json: ${(e as Error).message}`);
	}

	console.log(`
done. run the two services (two terminals):

  cd vendor/malq && bun src/main.ts        # disposable mail, 127.0.0.1:4400
  cd vendor/stratus-api/api && node api.js # cloud API, 127.0.0.1:3001

then import the games pointed at your own API:

  bun scripts/import-opium-cloud.ts \\
    --api-base http://127.0.0.1:3001 --api-key ${API_KEY} \\
    --catalog $(pwd)/vendor/stratus-api/cloud.json
`);
}
