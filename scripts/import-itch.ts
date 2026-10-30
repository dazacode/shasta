#!/usr/bin/env bun
/**
 * Adds itch.io games that run in the browser to the Shasta Store as linked apps.
 *
 * itch.io is the biggest home of browser-playable visual novels, and Ren'Py's own web export is how most of them
 * ship, so the default listing is exactly that: the Visual Novel genre and everything "made with Ren'Py", both
 * filtered to Web (HTML5). Every game is credited to its author(s) on itch.io, with itch.io itself as the host, and
 * links straight at the hosted build (the same html-classic.itch.zone URL itch.io loads in its own frame), so a
 * Store app opens the game itself, not a marketplace page.
 *
 * itch.io's browse only serves the first ~200 pages of a listing (36 games each, ~7.2k), which is the practical
 * ceiling for any one query; different listings/sorts are the way to reach more. Every entry carries the hidden
 * `itch` source tag, so re-runs update only this catalogue and a same-named app from another source is skipped.
 * The author's genre pick is not trusted on its own: lib/itchClass.ts reads the engine, genres and tags and keeps
 * only real visual novels on that shelf (scripts/retag-itch.ts applies the same rules to apps already imported).
 * Pages are cached in .cache/itch-games.json; delete it to read every page afresh.
 *
 *   bun scripts/import-itch.ts                 # Visual Novel genre + made-with-Ren'Py, Web (the default)
 *   bun scripts/import-itch.ts --top 100       # the 100 best-rated browser games on itch.io
 *   bun scripts/import-itch.ts --all           # the whole "games for Web" browse (top ~200 pages)
 *   bun scripts/import-itch.ts --dry --limit 30
 */
import { ITCH_SOURCE, isVisualNovel, itchTags } from "./lib/itchClass";
import { ITCH, enumerate, scrapeAll, type ItchGame, type Row } from "./lib/itchSource";
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const SITE = ITCH;
const CACHE = ".cache/itch-games.json";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const topN = Number(opt("top")) || 0;
const limit = Number(opt("limit")) || topN || Infinity;
const MAX_PAGES = Math.min(Number(opt("max-pages")) || 200, 200);

// ---- the listings to walk --------------------------------------------------------------------------------------
function listings(): string[] {
	if (topN) return [`${SITE}/games/top-rated/platform-web`];
	if (flag("all")) return [`${SITE}/games/platform-web`];
	// default: visual novels first, then Ren'Py web exports
	return [`${SITE}/games/genre-visual-novel/platform-web`, `${SITE}/games/made-with-renpy/platform-web`];
}

// ---- per-game metadata -----------------------------------------------------------------------------------------
function toItem(g: ItchGame): ImportItem {
	const description =
		g.blurb.length >= 20
			? g.blurb.slice(0, 1000)
			: `${g.title}, a browser-playable game on itch.io. Click and it runs — nothing to install.`;
	return {
		name: g.title.slice(0, 60),
		url: g.playUrl,
		summary: summarize(g.blurb || description, g.title),
		description,
		developers: g.authors.slice(0, 6),
		host: { name: "itch.io", url: SITE },
		// an author's "Visual Novel" genre is a claim, not a fact: lib/itchClass.ts decides the shelf
		tags: itchTags(g),
		category: "games",
		iconUrl: g.cover || undefined,
		bannerUrl: g.cover || undefined,
		notes: isVisualNovel(g) ? "A browser-playable visual novel found on itch.io." : "A browser-playable game found on itch.io.",
		source: ITCH_SOURCE,
	};
}

// ---- collect, de-duplicate (by game URL and by name), then import ----------------------------------------------
console.log(`listings: ${listings().join(", ")}`);
const all: Row[] = [];
for (const listing of listings()) {
	const part = await enumerate(listing, { maxPages: MAX_PAGES, limit });
	console.log(`${listing}: ${part.length} games`);
	all.push(...part);
	if (all.length >= limit * 3) break; // plenty of headroom before the per-game fetch
}

const byUrl = new Set<string>();
const byName = new Set<string>();
const seen: Row[] = [];
for (const r of all) {
	const u = r.url.toLowerCase().replace(/\/+$/, "");
	const n = r.title.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (!n || byUrl.has(u) || byName.has(n)) continue;
	byUrl.add(u);
	byName.add(n);
	seen.push(r);
}
console.log(`${all.length} listed, ${seen.length} unique`);

const rows = seen.slice(0, limit === Infinity ? undefined : limit);
console.log(`fetching metadata for ${rows.length} games…`);
const pages = await scrapeAll(rows, CACHE, 6);
const items = rows.map((r) => pages.get(r.url)).filter((g): g is ItchGame => !!g).map(toItem);
console.log(`${items.length} games with a playable build`);

if (flag("dry")) {
	for (const it of items.slice(0, 60)) console.log(`  · ${it.name}  [${it.tags.join(", ")}]  ${it.url}`);
}
await runImport(items, { dry: flag("dry"), only: opt("only"), jobs: Number(opt("jobs")) || 8 });
