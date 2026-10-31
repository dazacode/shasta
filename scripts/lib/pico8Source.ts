// Reading the Lexaloffle BBS PICO-8 cartridge browser. The listing page embeds a JS array (`pdat`) with every cart on
// the page — post id, thread id, title, author, thumbnail, tags and the cart's "lid" (the id the official player takes)
// — so the whole catalogue is read one request per 30 carts, with no per-cart page needed. A cart's own thread page is
// read only for its description. Shared by scripts/import-pico8.ts.
import { decode, get, mapLimit } from "./itchSource";

export const BBS = "https://www.lexaloffle.com";
/** the raw listing titles carry HTML entities; expand the common named ones, then the numeric/quote ones */
const NAMED: Record<string, string> = { ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", times: "×", deg: "°", middot: "·", amp: "&" };
const unentity = (s: string) => decode(s.replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m));
/** cat=7 is the PICO-8 forum, sub=2 its Cartridges tab, newest first */
const LISTING = `${BBS}/bbs/?cat=7&mode=carts&sub=2&orderby=ts`;
export const MAX_PAGE = 600; // safety ceiling: the walk stops at the first empty page (the BBS lists ~404 today)

export interface Cart {
	/** the cart's thread id */
	tid: number;
	/** the author's display name */
	author: string;
	title: string;
	/** the cart's "lid" (dat id), e.g. "pico_royale": what the official player takes */
	lid: string;
	/** author tags, e.g. ["platformer","wip"] */
	tags: string[];
	/** the BBS thumbnail path, e.g. /bbs/thumbs/pico8_pico_royale-0.png */
	thumb: string;
}

/** the official standalone player page, the same widget Lexaloffle hands out for embedding */
export const widgetUrl = (lid: string) => `${BBS}/bbs/widget.php?pid=${encodeURIComponent(lid)}`;
/** the cart's thread page */
export const threadUrl = (tid: number) => `${BBS}/bbs/?tid=${tid}`;
export const absUrl = (p: string) => (p.startsWith("http") ? p : BBS + p);
/** the thumbnail is a small square; the preview of the same shot is the wide cover */
export const previewUrl = (thumb: string) => absUrl(thumb).replace("/bbs/thumbs/", "/bbs/preview/");

/** the cart rows on one listing page */
export function parseListing(html: string): Cart[] {
	const m = /pdat\s*=\s*\[/.exec(html);
	if (!m) return [];
	const start = m.index + m[0].length - 1;
	let depth = 0;
	let end = start;
	for (let j = start; j < html.length; j++) {
		if (html[j] === "[") depth++;
		else if (html[j] === "]") {
			depth--;
			if (!depth) {
				end = j + 1;
				break;
			}
		}
	}
	let raw: unknown[][];
	try {
		// the array is a JS literal (backtick strings, trailing commas), so eval it
		raw = eval(html.slice(start, end)) as unknown[][];
	} catch {
		return [];
	}
	const carts: Cart[] = [];
	for (const r of raw) {
		if (!Array.isArray(r)) continue;
		// dat[19] is a flags int; bit 1 set means "show as cart" (else it is a plain thread)
		if (typeof r[19] !== "number" || !(r[19] & 2)) continue;
		const tid = Number(r[1]);
		const lid = String(r[22] ?? "");
		const title = unentity(String(r[2] ?? "")).replace(/\s+/g, " ").trim();
		if (!tid || !lid || title.length < 2) continue;
		carts.push({
			tid,
			author: unentity(String(r[8] ?? "")).replace(/\s+/g, " ").trim(),
			title,
			lid,
			tags: Array.isArray(r[18]) ? (r[18] as unknown[]).map(String) : [],
			thumb: String(r[3] ?? ""),
		});
	}
	return carts;
}

/** every cart on the BBS, newest first, one request per page until a page comes back empty */
export async function enumerateCarts(opts: { maxPages?: number; limit?: number; onPage?: (page: number, total: number) => void } = {}): Promise<Cart[]> {
	const maxPages = Math.min(opts.maxPages ?? MAX_PAGE, MAX_PAGE);
	const limit = opts.limit ?? Infinity;
	const out: Cart[] = [];
	for (let p = 1; p <= maxPages; p++) {
		const { status, text } = await get(`${LISTING}&page=${p}`);
		if (status !== 200 || !text) break;
		const rows = parseListing(text);
		out.push(...rows);
		opts.onPage?.(p, out.length);
		if (!rows.length || out.length >= limit) break;
		await Bun.sleep(60);
	}
	return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

/** the description in a cart's first post, or "" (many work-in-progress carts carry only the cart and no text) */
export function parseBlurb(html: string): string {
	// drop the player's JS (large) and the page CSS, so only post text is left
	const bare = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
	const from = bare.indexOf("Pin To Profile"); // the first post's header control
	if (from < 0) return "";
	const spam = bare.indexOf("Mark as Spam", from); // the first post ends at its moderation controls
	const region = bare.slice(from + "Pin To Profile".length, spam > from ? spam : from + 30000);
	// the post is a run of <p> paragraphs; the cart's own element (and its links/embed) lives in one of them
	const parts: string[] = [];
	for (const m of region.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
		const raw = m[1];
		if (/Cart File|Copy and paste the snippet below/i.test(raw)) continue; // the cart player + its info box
		const text = unentity(raw.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ")).trim();
		if (text) parts.push(text);
	}
	return parts.join("\n\n").replace(/\s*(Code|Embed)\s*[▽▾]\s*/g, " ").trim();
}

/** read many cart threads for their description, remembering every answer in `cacheFile` so a re-run is free */
export async function scrapeBlurbs(carts: Cart[], cacheFile: string, workers = 8): Promise<Map<number, string>> {
	const file = Bun.file(cacheFile);
	const cache: Record<string, string> = (await file.exists()) ? await file.json() : {};
	const todo = carts.filter((c) => !(String(c.tid) in cache));
	console.log(`${carts.length - todo.length} cart pages cached, fetching ${todo.length}…`);
	let done = 0;
	await mapLimit(todo, workers, async (c) => {
		const { status, text } = await get(threadUrl(c.tid), 4);
		cache[String(c.tid)] = status === 200 && text ? parseBlurb(text) : "";
		if (++done % 500 === 0) {
			await Bun.write(cacheFile, JSON.stringify(cache));
			console.log(`  … ${done}/${todo.length} cart pages read`);
		}
	});
	await Bun.write(cacheFile, JSON.stringify(cache));
	return new Map(carts.map((c) => [c.tid, cache[String(c.tid)] ?? ""]));
}
