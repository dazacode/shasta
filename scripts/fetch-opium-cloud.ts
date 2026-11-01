#!/usr/bin/env bun
/**
 * Refresh the opium.best CLOUD catalogue snapshot.
 *
 * Writes data/opium-cloud.json (record of what we imported) and shasta/public/opium-cloud.json
 * (the file the player page reads first, so it browses even before the live API answers).
 * The live stratus API is still the source of truth at play time; this is a cache + record.
 *
 *   bun scripts/fetch-opium-cloud.ts [--host cdn.vipersfutbol.com]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchCloudGames } from "./lib/opiumCloud";

const root = path.resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const { host, games } = await fetchCloudGames(opt("host"));
const payload = {
	generatedAt: new Date().toISOString(),
	host,
	api: `https://${host}/stratus`,
	total: games.length,
	games,
};

for (const file of [path.join(root, "data/opium-cloud.json"), path.join(root, "shasta/public/opium-cloud.json")]) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
	console.log(`wrote ${file}`);
}
console.log(`${games.length} cloud games via ${host}`);
