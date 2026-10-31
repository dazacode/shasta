#!/usr/bin/env bun
/**
 * Adds every game in gn-math's catalogue to the Shasta Store as a linked app.
 *
 * gn-math is a big browser-games site: ~850 games, its own JSON catalogue (id, name, cover, author, tags).
 * gn-math.dev went offline (2026-10-31), but the catalogue and every game page live on jsDelivr (GitHub repos
 * freebuisness/assets, /covers, /html), and that is what the apps open now: one game page each, no gn-math menu.
 * jsDelivr serves those pages as text/plain; Shasta's proxy shows them as HTML (shasta/src/proxy/plainHtml.ts).
 * Games already in the Store (wasm.rip / Obsidian / store.app) are skipped, so there are no duplicate listings.
 *
 *   bun scripts/import-gnmath.ts [--dry] [--only Celeste] [--jobs 6]
 */
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const CDN = "https://cdn.jsdelivr.net/gh/freebuisness";
const ZONES = `${CDN}/assets@main/zones.json`;
const COVER_URL = `${CDN}/covers@main`;
const HTML_URL = `${CDN}/html@main`;
const HOST = { name: "gn-math", url: "https://github.com/freebuisness/html" };
const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const res = await fetch(ZONES, { signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`${res.status} for ${ZONES}`);
const zones = (await res.json()) as {
	id: number;
	name: string;
	cover?: string;
	url?: string;
	author?: string;
	authorLink?: string;
	special?: string | string[];
}[];

const items: ImportItem[] = [];
for (const z of zones) {
	if (typeof z.id !== "number" || z.id < 0) continue; // <0 is the "suggest a game" card
	const name = (z.name || "").trim();
	// every game is `{HTML_URL}/<file>.html`; anything else is not a game
	if (!name || !z.url?.startsWith("{HTML_URL}/")) continue;
	const tags = [...(Array.isArray(z.special) ? z.special : z.special ? [z.special] : []), "game"];
	const by = z.author?.trim();
	const description = `Play ${name} in your browser. ${by ? `Made by ${by}. ` : ""}A web port from gn-math's game library; nothing to install, it runs in the tab.`;
	const cover = z.cover?.replace("{COVER_URL}", COVER_URL);
	items.push({
		name,
		url: z.url.replace("{HTML_URL}", HTML_URL),
		summary: summarize(description, name),
		description,
		developers: by ? [by] : [],
		host: HOST,
		tags,
		category: "games",
		iconUrl: cover,
		bannerUrl: cover,
		notes: "A browser game from gn-math's library, loaded from jsDelivr.",
		source: "gnmath",
	});
}

console.log(`${items.length} gn-math games`);
await runImport(items, { dry: argv.includes("--dry"), only: opt("only"), jobs: Number(opt("jobs")) || undefined });
