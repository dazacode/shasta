#!/usr/bin/env bun
/**
 * Adds every opium.best CLOUD game to the Shasta Store as its own app.
 *
 * The cloud section is a WebRTC streaming service; there is no page per game, so each entry gets a
 * player: by default a one-file PACKAGE (its own origin, sandboxed, downloadable) whose index.html is
 * the cloud player with that game's key baked in. With --linked the app instead opens the shared
 * player page /opium-cloud.html?g=<key>.
 *
 * Metadata (name, tags, description, art) is reused from the stratus catalogue. Source tag "opium-cloud"
 * marks our rows, so re-runs update them and other sources' same-name duplicates are skipped.
 *
 *   bun scripts/import-opium-cloud.ts [--dry] [--only "watch dogs"] [--jobs 6]
 *                                     [--mode packages|linked] [--origin https://edushasta.lol]
 */
import { fetchCloudGames, itemFromGame, pickMirror } from "./lib/opiumCloud";
import { runImport } from "./lib/storeImport";

const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const origin = opt("origin") ?? process.env.VITE_SITE_ORIGIN ?? "https://edushasta.lol";
const mode = (opt("mode") ?? "packages") as "packages" | "linked";
const host = opt("host") ?? (await pickMirror());

// --api-base points the apps at a self-hosted x8rr/stratus-api (prefix cloud/v1) instead of the mirrors
const apiBase = opt("api-base");
const api = apiBase
	? { base: apiBase.replace(/\/+$/, ""), prefix: opt("api-prefix") ?? "cloud/v1", key: opt("api-key") ?? "", catalog: opt("catalog") ?? "" }
	: null;

let games = (await fetchCloudGames(host)).games;
const catalog = opt("catalog");
if (catalog) {
	const fromCatalog = await fetch(catalog).then((r) => r.json());
	games = (Array.isArray(fromCatalog) ? fromCatalog : fromCatalog.games ?? []).map((g: any) => ({ ...g, key: g.key ?? g.game_key })).filter((g: any) => g.key && g.name);
}
console.log(`${games.length} opium cloud games via ${host} · mode=${mode} · origin=${origin}${api ? ` · api=${api.base}` : ""}`);

const items = games.map((g) => itemFromGame(g, { origin, mode, api }));
await runImport(items, {
	dry: argv.includes("--dry"),
	only: opt("only"),
	jobs: Number(opt("jobs")) || undefined,
	pending: argv.includes("--pending"),
	collisionSuffix: opt("suffix") ?? (argv.includes("--all") ? " (Cloud)" : undefined),
});
