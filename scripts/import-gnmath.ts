#!/usr/bin/env bun
/**
 * Adds every game in gn-math's catalogue (https://gn-math.dev) to the Shasta Store as a linked app.
 *
 * gn-math is a big browser-games site: ~850 games, its own JSON catalogue (id, name, cover, author, tags).
 * Games already in the Store (wasm.rip / Obsidian / store.app) are skipped, so there are no duplicate listings.
 *
 *   bun scripts/import-gnmath.ts [--dry] [--only Celeste] [--jobs 6]
 */
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const SITE = "https://gn-math.dev";
const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

async function text(url: string): Promise<string> {
	const r = await fetch(url);
	if (!r.ok) throw new Error(`${r.status} for ${url}`);
	return r.text();
}

const home = await text(`${SITE}/`);
const grab = (name: string) => {
	const m = new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(home);
	if (!m) throw new Error(`could not find ${name} in the gn-math page`);
	return m[1];
};
const coverBase = grab("coverURL");
const zonePath = grab("zonesURL");

const zones = (await (await fetch(`${SITE}${zonePath}`)).json()) as {
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
	if (!name || !z.url) continue;
	const tags = [...(Array.isArray(z.special) ? z.special : z.special ? [z.special] : []), "game"];
	const by = z.author?.trim();
	const description = `Play ${name} in your browser. ${by ? `Made by ${by}. ` : ""}A web port hosted on gn-math; nothing to install, it runs in the tab.`;
	items.push({
		name,
		url: `${SITE}/?id=${z.id}#embed`,
		summary: summarize(description, name),
		description,
		developers: by ? [by] : [],
		host: { name: "gn-math", url: SITE },
		tags,
		category: "games",
		iconUrl: z.cover ? `${SITE}${z.cover.replace("{COVER_URL}", coverBase)}` : undefined,
		bannerUrl: z.cover ? `${SITE}${z.cover.replace("{COVER_URL}", coverBase)}` : undefined,
		notes: "A browser game hosted on gn-math.",
		source: "gnmath",
	});
}

console.log(`${items.length} gn-math games`);
await runImport(items, { dry: argv.includes("--dry"), only: opt("only"), jobs: Number(opt("jobs")) || undefined });
