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
 *
 *   bun scripts/import-itch.ts                 # Visual Novel genre + made-with-Ren'Py, Web (the default)
 *   bun scripts/import-itch.ts --top 100       # the 100 best-rated browser games on itch.io
 *   bun scripts/import-itch.ts --all           # the whole "games for Web" browse (top ~200 pages)
 *   bun scripts/import-itch.ts --dry --limit 30
 */
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SITE = "https://itch.io";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const topN = Number(opt("top")) || 0;
const limit = Number(opt("limit")) || topN || Infinity;
const MAX_PAGES = Math.min(Number(opt("max-pages")) || 200, 200);

// ---- tiny HTTP with retries (itch.io rate-limits with 429) -----------------------------------------------------
async function get(url: string, tries = 6): Promise<{ status: number; text: string }> {
	let wait = 400;
	for (let i = 0; i < tries; i++) {
		try {
			const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/json,*/*" }, signal: AbortSignal.timeout(30000), redirect: "follow" });
			if (r.status === 404) return { status: 404, text: "" };
			if (r.status === 429 || r.status >= 500) {
				await Bun.sleep(wait);
				wait = Math.min(wait * 2, 8000);
				continue;
			}
			if (r.ok) return { status: r.status, text: await r.text() };
		} catch {}
		await Bun.sleep(wait);
		wait = Math.min(wait * 2, 8000);
	}
	return { status: 0, text: "" };
}

/** run `fn` over `list` with a fixed number of workers and a small stagger */
async function mapLimit<T, R>(list: T[], workers: number, fn: (t: T) => Promise<R>): Promise<R[]> {
	let i = 0;
	const out: R[] = new Array(list.length);
	await Promise.all(
		new Array(Math.min(workers, list.length || 1)).fill(0).map(async () => {
			while (i < list.length) {
				const j = i++;
				out[j] = await fn(list[j]);
				await Bun.sleep(80);
			}
		}),
	);
	return out;
}

const decode = (s: string) =>
	s
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();

// ---- the listings to walk --------------------------------------------------------------------------------------
interface Listing {
	url: string;
}
function listings(): Listing[] {
	if (topN) return [{ url: `${SITE}/games/top-rated/platform-web` }];
	if (flag("all")) return [{ url: `${SITE}/games/platform-web` }];
	// default: visual novels first, then Ren'Py web exports
	return [{ url: `${SITE}/games/genre-visual-novel/platform-web` }, { url: `${SITE}/games/made-with-renpy/platform-web` }];
}

interface Row {
	gameId: string;
	url: string;
	title: string;
	cover: string;
	blurb: string;
}

/** one listing, walked page by page through itch's JSON grid (lighter than the HTML page) */
async function enumerate(listing: Listing): Promise<Row[]> {
	const rows: Row[] = [];
	for (let p = 1; p <= MAX_PAGES; p++) {
		const sep = listing.url.includes("?") ? "&" : "?";
		const { status, text } = await get(`${listing.url}${sep}page=${p}&format=json`);
		if (status !== 200 || !text) break;
		let content = "";
		try {
			content = (JSON.parse(text) as { content?: string }).content ?? "";
		} catch {
			break;
		}
		// cells are <div ... data-game_id="ID" ...> ...; itch varies the attribute order, so cut on the opening tag
		// of each cell (identified by data-game_id on a <div>) rather than on a fixed class-first prefix
		const marks = [...content.matchAll(/<div\b[^>]*\bdata-game_id="(\d+)"[^>]*>/g)];
		if (!marks.length) break;
		for (let i = 0; i < marks.length; i++) {
			const c = content.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : content.length);
			const url = /<a\b[^>]*\bhref="([^"]+)"[^>]*class="[^"]*thumb_link/i.exec(c)?.[1] ?? /<a\b[^>]*class="[^"]*thumb_link[^"]*"[^>]*\bhref="([^"]+)"/i.exec(c)?.[1] ?? "";
			const cover = /<img\b[^>]*\bdata-lazy_src="([^"]*)"/i.exec(c)?.[1] ?? /<img\b[^>]*\bsrc="([^"]*)"/i.exec(c)?.[1] ?? "";
			const title = decode(/<a\b[^>]*class="[^"]*title game_link[^"]*"[^>]*>([^<]+)</i.exec(c)?.[1] ?? /<div[^>]*class="game_title"[^>]*>\s*<a[^>]*>([^<]+)</i.exec(c)?.[1] ?? "");
			const blurb = decode(/<div[^>]*class="game_text"[^>]*\btitle="([^"]*)"/i.exec(c)?.[1] ?? /<div[^>]*class="game_text"[^>]*>([^<]*)</i.exec(c)?.[1] ?? "");
			if (url && title) rows.push({ gameId: marks[i][1], url, title, cover, blurb });
		}
		console.log(`  · page ${p}: ${marks.length} (${rows.length} total)`);
		if (marks.length < 36 || rows.length >= limit) break;
		await Bun.sleep(120);
	}
	return rows;
}

// ---- per-game metadata -----------------------------------------------------------------------------------------
const unescape = (s: string) => decode(s.replace(/</g, "<"));
const tdRow = (html: string, label: string) =>
	new RegExp(`<td[^>]*>\\s*${label}\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i").exec(html)?.[1] ?? "";
const linksIn = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);

async function scrape(row: Row): Promise<ImportItem | null> {
	const { status, text } = await get(row.url);
	if (status !== 200 || !text) return null;

	// the playable build: itch renders it as a live iframe once the frame loads, or keeps the same markup in a
	// data-iframe attribute while it is lazy. Unescaping the page turns either into a real <iframe src="...">.
	// A build path may contain spaces (e.g. ".../A Tale of Crowns/index.html"), so read the quoted src, not the URL.
	const decoded = unescape(text);
	const src =
		[...decoded.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map((m) => m[1]).find((s) => /itch\.zone\/html\//.test(s)) ??
		/(https:\/\/(?:html-classic\.itch\.zone|html\.itch\.zone)\/html\/\d+\/[^\s"<>]+)/.exec(decoded)?.[1] ??
		"";
	if (!src || !/^https?:\/\//.test(src)) return null;
	const playUrl = src.replace(/\?v=\d+$/, "").replace(/ /g, "%20");

	const og = (p: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, "i").exec(text)?.[1] ?? "";
	const title = decode(/<h1[^>]*class="[^"]*game_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1]?.replace(/<[^>]+>/g, "") ?? "") || decode(og("og:title"));
	if (!title || title.length < 2) return null;
	const blurb = decode(og("og:description") || row.blurb);
	const cover = og("og:image") || og("twitter:image") || row.cover;

	const genres = linksIn(tdRow(text, "Genre"), /\/games\/genre-([a-z0-9-]+)/gi);
	const madeWith = linksIn(tdRow(text, "Made with"), /\/games\/made-with-([a-z0-9-]+)/gi);
	const tags = linksIn(tdRow(text, "Tags"), /\/games\/tag-([a-z0-9-]+)/gi);
	const authors = linksIn(tdRow(text, "Author"), /<a[^>]*>([^<]+)<\/a>/gi).map(decode).filter(Boolean);

	const isVN = genres.includes("visual-novel");
	const isRenpy = madeWith.includes("renpy");
	if (!isVN && !isRenpy) {
		// a "made-with" game that is neither tagged nor built with Ren'Py (e.g. a Ren'Py tool page) — still fine
	}

	// important tags first so they survive tagify's 10-tag cap (the source tag needs a free slot)
	const tagList = [
		...(isVN ? ["visual-novel"] : []),
		...(isRenpy ? ["renpy"] : []),
		...genres,
		...madeWith.filter((m) => m === "renpy"),
		...tags,
		"browser",
	];

	const description =
		blurb.length >= 20
			? blurb.slice(0, 1000)
			: `${title}, a browser-playable game on itch.io. Click and it runs — nothing to install.`;

	return {
		name: title.slice(0, 60),
		url: playUrl,
		summary: summarize(blurb || description, title),
		description,
		developers: authors.slice(0, 6),
		host: { name: "itch.io", url: SITE },
		tags: [...new Set(tagList)].slice(0, 8),
		category: "games",
		iconUrl: cover || undefined,
		bannerUrl: cover || undefined,
		notes: "A browser-playable game found on itch.io.",
		source: "itch",
	};
}

// ---- collect, de-duplicate (by game URL and by name), then import ----------------------------------------------
console.log(`listings: ${listings().map((l) => l.url).join(", ")}`);
const all: Row[] = [];
for (const listing of listings()) {
	const part = await enumerate(listing);
	console.log(`${listing.url}: ${part.length} games`);
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
let done = 0;
const items = (
	await mapLimit(rows, 6, async (r) => {
		const item = await scrape(r);
		if (++done % 250 === 0) console.log(`  … ${done}/${rows.length} scraped`);
		return item;
	})
).filter((x): x is ImportItem => !!x);
console.log(`${items.length} games with a playable build`);

if (flag("dry")) {
	for (const it of items.slice(0, 60)) console.log(`  · ${it.name}  [${it.tags.join(", ")}]  ${it.url}`);
}
await runImport(items, { dry: flag("dry"), only: opt("only"), jobs: Number(opt("jobs")) || 8 });
