#!/usr/bin/env bun
/**
 * Adds the PICO-8 cartridge catalogue of the Lexaloffle BBS to the Shasta Store as linked apps.
 *
 * PICO-8 is a fantasy console: thousands of tiny games (and tools, demos, jams) are posted as cartridges on the
 * Lexaloffle BBS, and Lexaloffle ships an official embeddable player for them (`/bbs/widget.php?pid=<lid>`, the same
 * widget itch.io frames). Each Store app links straight at that widget, so a cart plays on its own and nothing needs
 * installing; the author is credited, with the Lexaloffle BBS as host. The `pico8` tag puts every cart on its own
 * "PICO-8" shelf (see services/genres.ts) and the author's own genre tags (platformer, shooter, ...) put it on the
 * real ones too. Every entry carries the hidden `lexaloffle` source tag, so a re-run updates only this catalogue and a
 * same-named app from another source is skipped.
 *
 * The BBS lists ~12k carts; the listing is read 30 at a time (scripts/lib/pico8Source.ts) and each cart's thread is
 * read once for its description, cached in .cache/pico8-carts.json.
 *
 *   bun scripts/import-pico8.ts                 # the whole catalogue
 *   bun scripts/import-pico8.ts --dry --limit 40
 *   bun scripts/import-pico8.ts --no-blurbs     # skip the per-cart description fetch (listing metadata only)
 *   bun scripts/import-pico8.ts --only Celeste  # one app (name substring)
 */
import { PICO8_SOURCE, pico8Tags } from "./lib/pico8Class";
import { BBS, enumerateCarts, previewUrl, scrapeBlurbs, widgetUrl, type Cart } from "./lib/pico8Source";
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const CACHE = ".cache/pico8-carts.json";
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const limit = Number(opt("limit")) || Infinity;

function toItem(c: Cart, blurb: string): ImportItem {
	const by = c.author ? ` by ${c.author}` : "";
	const description = blurb.length >= 20 ? blurb.slice(0, 4000) : `${c.title}${by}, a PICO-8 cartridge from the Lexaloffle BBS. It plays in the browser — nothing to install.`;
	return {
		name: c.title.slice(0, 60),
		url: widgetUrl(c.lid),
		summary: summarize(blurb || description, c.title),
		description,
		developers: c.author ? [c.author.slice(0, 60)] : [],
		host: { name: "Lexaloffle BBS", url: `${BBS}/bbs/` },
		tags: pico8Tags(c.tags),
		category: "games",
		iconUrl: c.thumb ? previewUrl(c.thumb) : undefined,
		bannerUrl: c.thumb ? previewUrl(c.thumb) : undefined,
		notes: "A PICO-8 cartridge from the Lexaloffle BBS, played in the browser.",
		source: PICO8_SOURCE,
	};
}

// ---- the whole cartridge listing, de-duplicated by cart id then by name ----------------------------------------
console.log("reading the Lexaloffle BBS cartridge listing…");
const carts = await enumerateCarts({
	maxPages: Number(opt("max-pages")) || undefined,
	limit,
	onPage: (page, total) => {
		if (page % 25 === 0) console.log(`  … page ${page}, ${total} carts`);
	},
});
console.log(`${carts.length} carts listed`);

const byLid = new Set<string>();
const byName = new Set<string>();
const seen: Cart[] = [];
for (const c of carts) {
	const lid = c.lid.toLowerCase();
	const name = c.title.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (!name || byLid.has(lid) || byName.has(name)) continue;
	byLid.add(lid);
	byName.add(name);
	seen.push(c);
}
console.log(`${seen.length} unique carts (${carts.length - seen.length} duplicate id/name)`);

// ---- descriptions (one thread read each, cached) ---------------------------------------------------------------
let blurbs = new Map<number, string>();
if (!flag("no-blurbs") && !flag("dry")) {
	console.log(`reading ${seen.length} cart threads for descriptions…`);
	blurbs = await scrapeBlurbs(seen, CACHE, Number(opt("jobs")) || 8);
}

const items = seen.map((c) => toItem(c, blurbs.get(c.tid) ?? ""));

if (flag("dry")) {
	for (const it of items.slice(0, 60)) console.log(`  · ${it.name}  [${it.tags.join(", ")}]  ${it.url}`);
}
await runImport(items, { dry: flag("dry"), only: opt("only"), jobs: Number(opt("jobs")) || 8, pending: flag("pending") });
