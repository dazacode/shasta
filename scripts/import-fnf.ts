#!/usr/bin/env bun
/**
 * Adds the whole Friday Night Funkin' (FNF) browser-mod ecosystem to the Shasta Store as linked apps.
 *
 * The games are the playable builds each FNF portal embeds (their own CDN or a mod host), so a Store app opens the
 * game itself, not the portal page. Sources, in priority order (a name or URL seen twice is kept from the first):
 *
 *   fnfans.com            the requested FNF fan site (a handful of hand-picked mods)
 *   fnfgo.com             the largest portal that embeds directly (~2k mods, mod.fnfhub.net / its own CDNs)
 *   fridaynightfunkin.net a second large portal (overlaps fnfgo, adds its own write-ups)
 *   fnfmods.io            a portal that embeds via gamaverse (~3k mods)
 *
 * Apps already in the Store from another source (gn-math, wasm.rip, …) are skipped by name, so there are no duplicate
 * listings. Every entry carries the hidden `fnfportal` source tag, so re-runs update only this catalogue.
 *
 * The portals also host plenty of games that are not FNF (.io shooters, Fireboy & Watergirl, Sprunki, ...):
 * lib/fnfClass.ts gives only the real mods the FNF/rhythm tags and puts every other game in its own genre.
 *
 *   bun scripts/import-fnf.ts [--dry] [--limit 50] [--only Whitty] [--source fnfgo] [--jobs 10]
 */
import { FNF_SOURCE, fnfKind, fnfTags } from "./lib/fnfClass";
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const limit = Number(opt("limit")) || Infinity;
const onlySource = opt("source");

// ---- tiny HTML helpers -----------------------------------------------------------------------------------------
async function get(url: string, tries = 3): Promise<string> {
	for (let i = 0; i < tries; i++) {
		try {
			const r = await fetch(url, {
				headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
				signal: AbortSignal.timeout(25000),
				redirect: "follow",
			});
			if (r.ok) return await r.text();
			if (r.status === 404 || r.status === 410) return "";
		} catch {}
		await Bun.sleep(200 * (i + 1));
	}
	return "";
}

/** the content of a <meta property|name="key"> tag, either attribute order, quoted or bare (spaces kept) */
const VAL = `(?:"([^"]*)"|'([^']*)'|([^"'\\s>]+))`;
function meta(html: string, key: string): string {
	const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const grab = (m: RegExpExecArray | null) => (m ? m[1] ?? m[2] ?? m[3] ?? "" : "");
	const a = new RegExp(`<meta[^>]*(?:property|name)=["']?${k}["']?[^>]*content=${VAL}`, "i").exec(html);
	if (a) return grab(a);
	const b = new RegExp(`<meta[^>]*content=${VAL}[^>]*(?:property|name)=["']?${k}`, "i").exec(html);
	return grab(b);
}

const pageTitle = (html: string) => /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.trim() ?? "";

/** the src of the game iframe: prefer an id we know, skip a YouTube trailer, tolerate a lazy data-src */
function iframeSrc(html: string, ids: string[]): string {
	const tags = html.match(/<iframe\b[^>]*>/gi) ?? [];
	const pick = (t: string) => {
		const s = /\s(?:data-)?src=["']?([^"'\s>]+)/i.exec(t)?.[1] ?? "";
		return /^https?:/i.test(s) && !/(youtube(-nocookie)?\.com\/embed|player\.vimeo)/i.test(s) ? s : "";
	};
	for (const id of ids) {
		const t = tags.find((x) => new RegExp(`id=["']?${id}["']?`, "i").test(x));
		if (t) {
			const s = pick(t);
			if (s) return s;
		}
	}
	for (const t of tags) {
		const s = pick(t);
		if (s) return s;
	}
	return "";
}

/** run `fn` over `list` with a fixed number of workers (an unbounded Promise.all over 3k URLs is unkind) */
async function mapLimit<T, R>(list: T[], workers: number, fn: (t: T) => Promise<R>): Promise<R[]> {
	let i = 0;
	const out: R[] = new Array(list.length);
	await Promise.all(
		new Array(Math.min(workers, list.length)).fill(0).map(async () => {
			while (i < list.length) {
				const j = i++;
				out[j] = await fn(list[j]);
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

/** drop a volatile cache/token query that some hosts append, but keep meaningful ones (a mod file, a referrer) */
const cleanUrl = (u: string) => u.replace(/([?&])token=[0-9a-f]{6,}/i, "$1").replace(/[?&]$/, "").replace(/\?&/, "?");

/** "FNF Vs. Whitty - Play Online on FNFGO" -> "FNF Vs. Whitty"; "Play FNF VS Tabi Game Online !" -> "VS Tabi" */
function cleanName(raw: string): string {
	return decode(raw)
		.replace(/\s*[|·]\s*(fnfgo|friday\s*night\s*funkin'?|fnfmods\.io|fnf\s*mods?|fnf\s*fans).*$/i, "")
		.replace(/\s*[-–—]\s*(play\s+(online\s+)?(on|at)\s+)?(fnfgo|friday\s*night\s*funkin'?|fnfmods\.io|fnf\s*mods?).*$/i, "")
		.replace(/^\s*play\s+(fnf|friday\s*night\s*funkin'?)\s*/i, "")
		.replace(/\s*(game\s+)?online\s*!*\s*$/i, "")
		.replace(/\s*[-–—|]\s*$/, "")
		.replace(/\s+/g, " ")
		.trim();
}

const slugName = (slug: string) =>
	slug
		.replace(/^fnf[-_]?/i, "")
		.replace(/[-_]+/g, " ")
		.replace(/\b(vs|bf|gf|dlc|hd|v\d+)\b/gi, (m) => m.toUpperCase())
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.trim() || "FNF Mod";

// ---- source: fnfans.com (the requested site) -------------------------------------------------------------------
const FNF_IFRAMES = ["game-iframe", "gameframe", "game"];
async function fnfans(): Promise<ImportItem[]> {
	const sm = await get("https://fnfans.com/sitemap-0.xml");
	const slugs = [...sm.matchAll(/<loc>https:\/\/fnfans\.com\/en\/game\/([a-z0-9-]+)\/?<\/loc>/gi)].map((m) => m[1]).slice(0, limit);
	const items: ImportItem[] = [];
	await mapLimit(slugs, 10, async (slug) => {
		const html = await get(`https://fnfans.com/en/game/${slug}/`);
		if (!html) return;
		const url = iframeSrc(html, FNF_IFRAMES);
		if (!url) return;
		const h1 = decode(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "");
		const name = cleanName(h1 || meta(html, "og:title") || pageTitle(html)) || slugName(slug);
		if (!name) return;
		const cover = /cover\.(webp|png|jpe?g)/i.test(html)
			? `https://fnfans.com/fnf/games/${slug}/cover.webp`
			: `https://fnfans.com/fnf/games/${slug}/cover.png`;
		const description =
			meta(html, "og:description") ||
			meta(html, "description") ||
			`Play ${name}, a Friday Night Funkin' mod, in your browser — nothing to install.`;
		items.push(entry({ name, url, cover, description, hostName: "FNFans", hostUrl: "https://fnfans.com", extra: ["fan-picked"] }));
	});
	return items;
}

// ---- source: fnfgo.com (biggest, direct CDN embeds) ------------------------------------------------------------
async function fnfgo(): Promise<ImportItem[]> {
	const sm = await get("https://www.fnfgo.com/wp-sitemap-posts-post-1.xml");
	return scrapePosts({
		hosts: [...sm.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]).filter((u) => /\/[a-z0-9-]+\/$/i.test(u)),
		site: "https://www.fnfgo.com",
		hostName: "FNFGO",
		cover: (html) => meta(html, "og:image"),
	});
}

// ---- source: fridaynightfunkin.net (second portal, same mod hosts) ---------------------------------------------
async function fnfnet(): Promise<ImportItem[]> {
	const sm = await get("https://www.fridaynightfunkin.net/wp-sitemap-posts-post-1.xml");
	return scrapePosts({
		hosts: [...sm.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]).filter((u) => /\/[a-z0-9-]+\/?$/i.test(u)),
		site: "https://www.fridaynightfunkin.net",
		hostName: "Friday Night Funkin",
		// no og:image on this theme; the game cover is the .gameplayimg in the body
		cover: (html) => /<img[^>]+class=["']gameplayimg["'][^>]+src=["']([^"']+)["']/i.exec(html)?.[1] ?? "",
	});
}

/** shared scrape for the two WordPress portals that embed the game in a #gameframe iframe */
async function scrapePosts(o: { hosts: string[]; site: string; hostName: string; cover: (html: string) => string }): Promise<ImportItem[]> {
	const items: ImportItem[] = [];
	await mapLimit(o.hosts.slice(0, limit === Infinity ? undefined : limit), 10, async (page) => {
		const html = await get(page);
		if (!html) return;
		const url = iframeSrc(html, ["gameframe", "game-iframe", "game"]);
		if (!url) return;
		const slug = page.replace(/\/+$/, "").split("/").pop() ?? "";
		const name = cleanName(meta(html, "og:title") || pageTitle(html)) || slugName(slug);
		if (!name || name.length < 2) return;
		const img = o.cover(html);
		const cover = img && img.startsWith("/") ? o.site + img : img;
		const description =
			meta(html, "description") || meta(html, "og:description") || `Play ${name}, a Friday Night Funkin' mod, in your browser.`;
		items.push(entry({ name, url, cover, description, hostName: o.hostName, hostUrl: o.site, extra: [] }));
	});
	return items;
}

// ---- source: fnfmods.io (embeds via gamaverse) -----------------------------------------------------------------
async function fnfmods(): Promise<ImportItem[]> {
	const sm = await get("https://fnfmods.io/sitemap.xml");
	const slugs = [...sm.matchAll(/<loc>https:\/\/fnfmods\.io\/([a-z0-9-]+)<\/loc>/gi)].map((m) => m[1]).slice(0, limit);
	const items: ImportItem[] = [];
	await mapLimit(slugs, 10, async (slug) => {
		const html = await get(`https://fnfmods.io/${slug}`);
		if (!html) return;
		const url = iframeSrc(await get(`https://fnfmods.io/${slug}.embed`), ["iframehtml5", "iframe"]);
		if (!url) return;
		const name = cleanName(meta(html, "og:title") || pageTitle(html)) || slugName(slug);
		if (!name || name.length < 2) return;
		const img = meta(html, "og:image");
		const cover = img && img.startsWith("/") ? `https://fnfmods.io${img}` : img;
		const description =
			meta(html, "description") || meta(html, "og:description") || `Play ${name}, a Friday Night Funkin' mod, in your browser.`;
		items.push(entry({ name, url, cover, description, hostName: "FNFmods.io", hostUrl: "https://fnfmods.io", extra: [] }));
	});
	return items;
}

// ---- shared item shape -----------------------------------------------------------------------------------------
function entry(o: { name: string; url: string; cover: string; description: string; hostName: string; hostUrl: string; extra: string[] }): ImportItem {
	const name = o.name.slice(0, 60);
	const kind = fnfKind(name, o.url);
	// the portals' fallback text calls everything an FNF mod; say nothing wrong about the other games
	const said = kind === "fnf" ? o.description : o.description.replace(/,? a Friday Night Funkin' mod,?/, "");
	const description = said.replace(/\s+/g, " ").trim().slice(0, 1200);
	return {
		name,
		url: cleanUrl(o.url),
		summary: summarize(said, name),
		description,
		developers: [], // the mod's own creator is rarely named on these portals; the site is credited as host
		host: { name: o.hostName, url: o.hostUrl },
		tags: [...fnfTags(name, o.url), ...o.extra],
		category: "games",
		iconUrl: o.cover || undefined,
		bannerUrl: o.cover || undefined,
		notes: kind === "fnf" ? `A browser-playable Friday Night Funkin' mod, indexed from ${o.hostName}.` : `A browser game, indexed from ${o.hostName}.`,
		source: FNF_SOURCE,
	};
}

// ---- collect, de-duplicate (by name and by game URL), then import ----------------------------------------------
const SOURCES: Record<string, () => Promise<ImportItem[]>> = {
	fnfans,
	fnfgo,
	fnfnet,
	fnfmods,
};

const order = ["fnfans", "fnfgo", "fnfnet", "fnfmods"].filter((s) => !onlySource || s === onlySource);
const all: ImportItem[] = [];
for (const s of order) {
	const part = await SOURCES[s]();
	console.log(`${s}: ${part.length} mods`);
	all.push(...part);
}

const byName = new Map<string, ImportItem>();
const byUrl = new Map<string, ImportItem>();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const urlKey = (u: string) => {
	try {
		const x = new URL(u);
		return `${x.hostname}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
	} catch {
		return u.toLowerCase();
	}
};
for (const it of all) {
	const nk = norm(it.name);
	const uk = urlKey(it.url);
	if (!nk || byName.has(nk) || byUrl.has(uk)) continue;
	byName.set(nk, it);
	byUrl.set(uk, it);
}
const items = [...byName.values()].slice(0, limit);
console.log(`${all.length} mods scraped, ${items.length} unique`);

if (argv.includes("--dry")) for (const it of items) console.log(`  · ${it.name}  ${it.url}`);
await runImport(items, { dry: argv.includes("--dry"), only: opt("only"), jobs: Number(opt("jobs")) || 10 });
