// Reading itch.io: its browse listings (JSON grid) and a game's own page (the playable build, genres, engine, tags,
// authors). Shared by scripts/import-itch.ts and scripts/retag-itch.ts, so both see a game the same way.

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
export const ITCH = "https://itch.io";

// ---- tiny HTTP with retries (itch.io rate-limits with 429) -----------------------------------------------------
export async function get(url: string, tries = 6): Promise<{ status: number; text: string }> {
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
export async function mapLimit<T, R>(list: T[], workers: number, fn: (t: T) => Promise<R>): Promise<R[]> {
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

export const decode = (s: string) =>
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

export interface Row {
	gameId: string;
	url: string;
	title: string;
	cover: string;
	blurb: string;
}

/** one listing, walked page by page through itch's JSON grid (lighter than the HTML page) */
export async function enumerate(listingUrl: string, opts: { maxPages?: number; limit?: number } = {}): Promise<Row[]> {
	const maxPages = Math.min(opts.maxPages ?? 200, 200);
	const limit = opts.limit ?? Infinity;
	const rows: Row[] = [];
	for (let p = 1; p <= maxPages; p++) {
		const sep = listingUrl.includes("?") ? "&" : "?";
		const { status, text } = await get(`${listingUrl}${sep}page=${p}&format=json`);
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

/** everything a game's itch.io page says about it */
export interface ItchGame {
	/** the itch.io page */
	page: string;
	/** the hosted build the Store app links to (html-classic.itch.zone) */
	playUrl: string;
	title: string;
	blurb: string;
	cover: string;
	/** itch's Genre row (author-chosen), e.g. visual-novel, puzzle */
	genres: string[];
	/** itch's "Made with" row: the engine/tools, e.g. renpy, bitsy, twine, unity */
	madeWith: string[];
	/** itch's Tags row */
	tags: string[];
	authors: string[];
}

const unescape = (s: string) => decode(s.replace(/</g, "<"));
const tdRow = (html: string, label: string) =>
	new RegExp(`<td[^>]*>\\s*${label}\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i").exec(html)?.[1] ?? "";
const linksIn = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1].toLowerCase());

/** a game's page, or null when it has no browser build (or is gone) */
export async function scrapeGame(page: string, fallback: { blurb?: string; cover?: string } = {}): Promise<ItchGame | null> {
	const { status, text } = await get(page);
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

	const og = (p: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, "i").exec(text)?.[1] ?? "";
	const title = decode(/<h1[^>]*class="[^"]*game_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1]?.replace(/<[^>]+>/g, "") ?? "") || decode(og("og:title"));
	if (!title || title.length < 2) return null;
	return {
		page,
		playUrl: playUrlOf(src),
		title,
		blurb: decode(og("og:description") || fallback.blurb || ""),
		cover: og("og:image") || og("twitter:image") || fallback.cover || "",
		genres: linksIn(tdRow(text, "Genre"), /\/games\/genre-([a-z0-9-]+)/gi),
		madeWith: linksIn(tdRow(text, "Made with"), /\/games\/made-with-([a-z0-9-]+)/gi),
		tags: linksIn(tdRow(text, "Tags"), /\/games\/tag-([a-z0-9-]+)/gi),
		authors: [...tdRow(text, "Author").matchAll(/<a[^>]*>([^<]+)<\/a>/gi)].map((m) => decode(m[1])).filter(Boolean),
	};
}

/** the build URL as the Store stores it (no cache-buster, spaces escaped) */
export const playUrlOf = (src: string) => src.replace(/\?v=\d+$/, "").replace(/ /g, "%20");

/**
 * Scrape many game pages, remembering every answer in `cacheFile` (a JSON map page -> game or null) so a re-run, or
 * a retag after an import, does not fetch a page twice. Saved every 200 pages, so an interrupted run resumes.
 */
export async function scrapeAll(rows: Row[], cacheFile: string, workers = 8): Promise<Map<string, ItchGame | null>> {
	const file = Bun.file(cacheFile);
	const cache: Record<string, ItchGame | null> = (await file.exists()) ? await file.json() : {};
	const todo = rows.filter((r) => !(r.url in cache));
	console.log(`${rows.length - todo.length} pages cached, fetching ${todo.length}…`);
	let done = 0;
	await mapLimit(todo, workers, async (r) => {
		cache[r.url] = await scrapeGame(r.url, r);
		if (++done % 200 === 0) {
			await Bun.write(cacheFile, JSON.stringify(cache));
			console.log(`  … ${done}/${todo.length} scraped`);
		}
	});
	await Bun.write(cacheFile, JSON.stringify(cache));
	return new Map(rows.map((r) => [r.url, cache[r.url] ?? null]));
}
