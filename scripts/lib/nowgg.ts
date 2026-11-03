// Shared machinery for now.gg's cloud-gaming library.
//
// now.gg is a cloud Android player: the catalogue is open JSON (GET /ncm/appsc/v1/getAppsList,
// ~1,180 apps) and a session is a handful of JSON calls + one RTCPeerConnection against
// /oapi/<n>/play/v1/*. The protocol was recovered from now.gg's own bundle (see ../nowgg-recon).
// Here we turn the catalogue into Store items whose player is `shasta/public/nowgg.html`, baked into
// a one-file package with that game's appId.
//
// Names are the game's own; " (now.gg)" is added only when another source already lists the same name
// (runImport's collisionSuffix). The "Cloud games" shelf (tag cloud-gaming) tells them apart. Source tag "nowgg"
// marks our rows so re-runs update them.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { packageFromHtml } from "./packageBuild";
import { cleanText, norm, summarize, type ImportItem } from "./storeImport";

const root = path.resolve(import.meta.dir, "../..");
const PLAYER_TEMPLATE = path.join(root, "shasta/public/nowgg.html");

export interface NowggApp {
	appId: string | number;
	appName?: string;
	appGenre?: string;
	playUrl?: string;
	appDeveloperInfo?: { name?: string };
	media?: { icon?: string; tile?: string };
	appType?: string;
	appPageUrl?: string;
	appSlug?: string;
	companyName?: string;
	packageName?: string;
}

const BUCKETS = ["topApps", "topBarApps", "showcaseApps", "otherApps", "remainingApps"];

/** The whole now.gg catalogue, deduped by appId. The endpoint is open and works from any IP. */
export async function fetchCatalog(): Promise<NowggApp[]> {
	const r = await fetch("https://now.gg/ncm/appsc/v1/getAppsList", { headers: { accept: "application/json", "x-ngg-fe-version": "berlin-v1.54.400-arm.5" }, signal: AbortSignal.timeout(30_000) });
	if (!r.ok) throw new Error(`${r.status} for /ncm/appsc/v1/getAppsList`);
	const j = (await r.json()) as Record<string, NowggApp[]>;
	const seen = new Map<string, NowggApp>();
	for (const b of BUCKETS) for (const a of j[b] ?? []) if (a?.appId && !seen.has(String(a.appId))) seen.set(String(a.appId), a);
	return [...seen.values()];
}

// ---- the game's own now.gg page ---------------------------------------------------------------------------------
// The catalogue only has a name, a genre and a portrait tile (114 of them now.gg's generic placeholder). Each game's
// page (`appPageUrl`, a Next.js page) carries the real record in __NEXT_DATA__: whether it is a game at all
// (`genreType`), sub-genres, the 16:9 desktop banner, the logo and an "About the Game" write-up. Read once, cached.

export interface NowggPage {
	/** "gaming" | "non-gaming" | null when the page has no CMS record */
	genreType: string | null;
	genres: string[];
	subGenres: string[];
	/** the game's own write-up (HTML), now.gg's marketing paragraphs still in it; see describe() */
	overview: string;
	banner: string | null;
	ogimage: string | null;
	logo: string | null;
	icon: string | null;
	orientation: string | null;
	developer: string | null;
	/** the appId the page redirected to when it is ANOTHER entry (a duplicate, or a launcher such as Aptoide) */
	movedTo: string | null;
}

const PAGE_CACHE = path.join(root, ".cache/nowgg-pages.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
/** now.gg's stand-in art: never use it as a game's icon or banner */
export const isPlaceholder = (u?: string | null) => !u || /\/apps-content\/default\//.test(u);

export async function fetchPage(a: NowggApp): Promise<NowggPage | null> {
	if (!a.appPageUrl || !/^https:\/\/now\.gg\/apps\//.test(a.appPageUrl)) return null;
	const r = await fetch(a.appPageUrl, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
	if (!r.ok) throw new Error(`${r.status} for ${a.appPageUrl}`);
	const html = await r.text();
	const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
	if (!m) throw new Error(`no __NEXT_DATA__ in ${a.appPageUrl}`);
	const pp = JSON.parse(m[1])?.props?.pageProps ?? {};
	const info = pp.appInfo ?? {};
	const d = pp.appPageSpecificData?.appPackageInfo?.data ?? {};
	const dm = d.media?.desktop ?? {};
	const names = (l: any) => (Array.isArray(l) ? l.map((x: any) => x?.slug || x?.name).filter((x: any) => typeof x === "string") : []);
	return {
		genreType: typeof d.genreType === "string" ? d.genreType : null,
		genres: names(d.genre),
		subGenres: names(d.subCategories),
		overview: typeof d.overview_description === "string" ? d.overview_description : "",
		banner: info.media?.desktop?.banner || dm.banner || null,
		ogimage: dm.ogimage || null,
		logo: info.media?.logo || dm.logo || null,
		icon: info.media?.icon || dm.icon || null,
		orientation: info.initialOrientation || null,
		developer: info.appDeveloperInfo?.name || null,
		// now.gg 308s most pages to a canonical slug (same id); only a different id means another entry
		movedTo: ((id) => (id && id !== String(a.appId) ? id : null))(new URL(r.url).pathname.split("/")[3] ?? null),
	};
}

/** Every catalogue entry's page, cached in .cache/nowgg-pages.json (keyed by appId; `--refresh` refetches). */
export async function fetchPages(apps: NowggApp[], opts: { refresh?: boolean; jobs?: number } = {}): Promise<Map<string, NowggPage | null>> {
	let cache: Record<string, NowggPage | null> = {};
	try {
		if (!opts.refresh) cache = JSON.parse(readFileSync(PAGE_CACHE, "utf8"));
	} catch {}
	const todo = apps.filter((a) => !(String(a.appId) in cache));
	let i = 0;
	let n = 0;
	const save = () => {
		mkdirSync(path.dirname(PAGE_CACHE), { recursive: true });
		writeFileSync(PAGE_CACHE, JSON.stringify(cache));
	};
	await Promise.all(
		new Array(Math.min(opts.jobs ?? 6, todo.length)).fill(0).map(async () => {
			while (i < todo.length) {
				const a = todo[i++];
				for (let attempt = 0; attempt < 3; attempt++) {
					try {
						cache[String(a.appId)] = await fetchPage(a);
						break;
					} catch (e) {
						if (attempt === 2) console.warn(`  page ${a.appId} ${a.appName}: ${(e as Error).message}`);
						else await Bun.sleep(1500 * (attempt + 1));
					}
				}
				if (++n % 100 === 0) {
					console.log(`  … ${n}/${todo.length} pages`);
					save();
				}
			}
		}),
	);
	if (todo.length) save();
	return new Map(apps.map((a) => [String(a.appId), cache[String(a.appId)] ?? null]));
}

export const playerUrl = (origin: string, appId: string) => `${origin.replace(/\/+$/, "")}/nowgg.html?g=${encodeURIComponent(appId)}`;

/** A one-file package: the player page with this game's appId/name/cover and the /nowgg proxy baked in. */
export function buildPlayerPackage(a: NowggApp, site: string | null, shown?: { name?: string; cover?: string | null }): Uint8Array {
	const tpl = readFileSync(PLAYER_TEMPLATE, "utf8");
	const name = shown?.name ?? a.appName ?? "";
	const cfg = JSON.stringify({ appId: String(a.appId), name, cover: shown?.cover ?? a.media?.tile ?? a.media?.icon ?? null });
	const proxy = site ? JSON.stringify(`${site.replace(/\/+$/, "")}/nowgg`) : "null";
	const html = tpl.replace("/*__CONFIG__*/null", cfg).replace("/*__PROXY__*/null", proxy);
	return packageFromHtml(html, name || "now.gg");
}

// ---- which entries are games ------------------------------------------------------------------------------------
// The catalogue is not only games: now.gg's own pages (non-numeric ids such as "jpportal", "blogpage",
// "subscription", "battlecoin", which borrow Roblox/TikTok art), Android apps (TikTok, Instagram, Temu, AI photo
// editors, app stores) and launchers. The page's `genreType` says "non-gaming" for most apps; pages without a record
// fall back to the catalogue genre; a few apps now.gg files under a game genre are named here.

const NON_GAME_GENRES = new Set(["social", "productivity", "video players & editors", "tools", "communication", "entertainment", "business management", "portal", "shopping", "photography", "other"]);
/** apps now.gg labels "gaming" (homework solvers, chatbots, photo tools, app stores) */
const NOT_A_GAME = /\b(mathway|photomath|qanda|question\.ai|simsimi|polybuzz|aptoide|app launcher|copilot|bing|keyboard|ai (art|photo|image|mirror|music)|photo (editor|enhancer|generator|animator|ai)|avatar generator|image generator|face swap|remove objects|zepeto|imvu|kepithor rewards|grocery|quran|wsup\.ai|القرآن)\b/i;

export type Verdict = { keep: true } | { keep: false; why: string };

export function classify(a: NowggApp, page: NowggPage | null): Verdict {
	const id = String(a.appId);
	if (!/^\d+$/.test(id)) return { keep: false, why: "now.gg's own page, not a game" };
	if (NOT_A_GAME.test(a.appName ?? "")) return { keep: false, why: "an app, not a game" };
	if (page?.genreType === "non-gaming") return { keep: false, why: "an app (now.gg: non-gaming)" };
	if (page?.movedTo) return { keep: false, why: `its page is entry ${page.movedTo}'s (a duplicate or a launcher)` };
	if (!page?.genreType && NON_GAME_GENRES.has((a.appGenre ?? "").toLowerCase())) return { keep: false, why: `no game record, genre "${a.appGenre}"` };
	return { keep: true };
}

/** How complete an entry's listing is: picks which of two same-named entries to keep. */
const richness = (a: NowggApp, p: NowggPage | null) =>
	(p?.genreType === "gaming" ? 4 : 0) + (describe(p?.overview ?? "", a.appName ?? "").length > 200 ? 2 : 0) + (!isPlaceholder(p?.banner) ? 1 : 0) + (a.appType === "Android" ? 0.5 : 0);

/**
 * The games to list, one per game. now.gg lists some games twice (two appIds, same name): same developer = the
 * same game, keep the richer entry; a different developer = a different game (Geometry Dash by RobTop vs a remake),
 * which keeps its own entry, named with its developer.
 */
export function selectGames(apps: NowggApp[], pages: Map<string, NowggPage | null>) {
	const kept: { app: NowggApp; page: NowggPage | null; name: string }[] = [];
	const dropped: { app: NowggApp; why: string }[] = [];
	const groups = new Map<string, NowggApp[]>();
	for (const a of apps) {
		const v = classify(a, pages.get(String(a.appId)) ?? null);
		if (!v.keep) {
			dropped.push({ app: a, why: v.why });
			continue;
		}
		const k = norm(cleanName(a.appName ?? ""));
		groups.set(k, [...(groups.get(k) ?? []), a]);
	}
	for (const group of groups.values()) {
		const byDev = new Map<string, NowggApp[]>();
		for (const a of group) {
			const d = norm(a.appDeveloperInfo?.name ?? "");
			byDev.set(d, [...(byDev.get(d) ?? []), a]);
		}
		const best = [...byDev.values()].map((same) => {
			const sorted = same.slice().sort((x, y) => richness(y, pages.get(String(y.appId)) ?? null) - richness(x, pages.get(String(x.appId)) ?? null) || Number(y.appId) - Number(x.appId));
			for (const d of sorted.slice(1)) dropped.push({ app: d, why: `duplicate of ${sorted[0].appId}` });
			return sorted[0];
		});
		best.sort((x, y) => richness(y, pages.get(String(y.appId)) ?? null) - richness(x, pages.get(String(x.appId)) ?? null));
		best.forEach((a, i) => {
			const base = cleanName(a.appName ?? "");
			const dev = a.appDeveloperInfo?.name?.trim();
			kept.push({ app: a, page: pages.get(String(a.appId)) ?? null, name: i === 0 || !dev ? base : `${base} (${dev})` });
		});
	}
	return { kept, dropped };
}

// ---- metadata ---------------------------------------------------------------------------------------------------

/** "The Sims™ FreePlay" -> "The Sims FreePlay"; long store titles lose their tagline. */
export function cleanName(raw: string): string {
	let n = raw.replace(/[™®©\u200b]/g, "").replace(/\s+/g, " ").trim();
	// Roblox experiences carry their update banner in the name ("UPD Fish It", "Update 65 Anime Rangers X")
	n = n.replace(/^(UPD(ATE)?( \d+)?|NEW CODE|EVENT|Part \d+)\s+(?=\S)/i, "");
	if (n.length > 40) {
		// a store title's tagline: "Cookie Run: Kingdom - Kingdom Builder & Battle RPG" -> "Cookie Run: Kingdom"
		const dash = n.search(/\s[-–—|]\s/);
		const colon = n.search(/:\s/);
		const cut = dash > 3 ? dash : colon > 3 ? colon : -1;
		if (cut > 3) n = n.slice(0, cut).trim();
	}
	return n.slice(0, 56);
}

const decode = (s: string) =>
	s
		.replace(/&nbsp;|&#160;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;|&#8217;|&rsquo;/g, "'")
		.replace(/&#8216;|&lsquo;/g, "'")
		.replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
		.replace(/&#8211;|&ndash;/g, "–")
		.replace(/&#8212;|&mdash;/g, "—")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&[a-z#0-9]+;/gi, " ");

/** a heading whose section is now.gg's own pitch, not the game */
const PITCH_HEADING = /how to (play|use|download|unblock)|download|unblock|play .*online|on pc|chromebook|now\.gg|why play/i;
/** a sentence that sells now.gg rather than describing the game */
// (the recurring ones were found by counting identical sentences across the whole catalogue, the game name masked)
const PITCH_SENTENCE = new RegExp(
	[
		"now\\.gg", "mobile cloud", "in (your|the|a) (web )?browser", "web browser", "without (any |having to )?download", "no download", "download or install",
		"play .{0,60} online[.!]?$", "^play .{0,90} online for free", "for free on (pc|mobile)", "lag-free", "low latency", "bluestacks", "in the cloud on your",
		"(logged|signed) in to a new device", "don.t be concerned", "gaming machine", "share the game.s link", "(lengthy|long) downloads", "(nagging|annoying) updates",
		"many more interesting online games", "online gaming world", "right away and start", "^so,? (get in|jump into)", "start (playing|slaying)[.!]?$",
		"created with html5 to offer", "play in browser", "phone can.t handle", "up to snuff", "whether you.re on a pc", "^and the best part\\?",
		"what are you waiting for", "^no worries", "download the game now", "^how to play this game",
	].join("|"),
	"i",
);

/**
 * The game's own write-up as plain text with paragraphs: now.gg's boilerplate first paragraph
 * ("X is a … game developed by Y. With now.gg, you can …"), its "How to play … online" sections and every sentence
 * selling now.gg are dropped; headings like "Game Features" stay as a line, list items become "• " lines.
 */
export function describe(html: string, name: string): string {
	if (!html) return "";
	let h = html.replace(/\r/g, "");
	// the boilerplate opener ends at the first double break
	const br = h.search(/<br\s*\/?>\s*<br\s*\/?>/i);
	if (br >= 0 && br < 600 && /now\.gg/i.test(h.slice(0, br))) h = h.slice(br).replace(/^(<br\s*\/?>\s*)+/i, "");
	h = h
		.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, t) => `\n\n\u0001${t.replace(/<[^>]+>/g, "").trim()}\n\n`)
		.replace(/<li[^>]*>/gi, "\n• ")
		.replace(/<\/(p|div|ul|ol)>/gi, "\n\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "");
	h = decode(h).replace(/\n\s*\n(?=• )/g, "\n");
	const out: string[] = [];
	let skipping = false;
	for (const block of h.split(/\n{2,}/)) {
		const b = block.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
		if (!b) continue;
		if (b.startsWith("\u0001")) {
			const head = b.slice(1).trim();
			skipping = PITCH_HEADING.test(head);
			if (!skipping && head && !/^(about the game|game overview|about)$/i.test(head)) out.push(head.replace(/\?$/, ""));
			continue;
		}
		if (skipping) continue;
		const lines = b
			.split("\n")
			.map((line) => {
				const bullet = line.startsWith("• ");
				const text = bullet ? line.slice(2) : line;
				const kept = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).filter((s) => !PITCH_SENTENCE.test(s)).join(" ").trim();
				return kept ? (bullet ? `• ${kept}` : kept) : "";
			})
			.filter(Boolean);
		if (lines.length) out.push(lines.join("\n"));
	}
	// a heading left with nothing under it
	const clean = out.filter((p, i) => !(p.length < 40 && !/[.!]$/.test(p) && (i === out.length - 1 || out[i + 1].length < 40 && !/[.!]$/.test(out[i + 1]))));
	let text = "";
	for (const p of clean) {
		if (text.length + p.length > 2400) break;
		text += (text ? "\n\n" : "") + p;
	}
	// a write-up that only repeats the name is no write-up
	return text.replace(/\s+/g, " ").trim().toLowerCase() === name.toLowerCase() ? "" : text;
}

/** now.gg's genre + sub-genre slugs -> the Store's tags (services/genres.ts); noise ("unblocked", "cool", "pc") dropped. */
const TAG_ALIAS: Record<string, string> = {
	"role-playing": "rpg", "role playing": "rpg", mmorpg: "rpg", "tactical-role-playing": "rpg", "turn-based-strategy": "turn-based-strategy",
	shooting: "shooter", "first-person-shooter": "fps", "third-person-shooter": "shooter", "tactical-shooter": "shooter", gun: "shooter",
	zombie: "zombies", card: "card-game", "card-battle": "card-game", solitaire: "card-game", freecell: "card-game", board: "board-game",
	"car-racing": "racing", "drag-racing": "racing", "truck-racing": "racing", motorsport: "racing", driving: "driving", car: "cars",
	brain: "logic", "brain-teaser": "logic", "jigsaw-puzzle": "puzzle", jigsaw: "puzzle", "hidden-object": "puzzle", mahjong: "puzzle", "mahjong-solitaire": "puzzle", "match-3": "match-3", matching: "match-3",
	educational: "education", "educational-games": "education", math: "education", mathematics: "education",
	scary: "horror", "jump-scare": "horror", "survival-horror": "survival-horror", "survival games": "survival",
	farm: "farming", "city-building": "building", "tower-defense": "tower-defense", "tile-matching": "match-3", running: "runner", runner: "runner",
	"2-player": "multiplayer", "battle-royale": "shooter", "beat-em-up": "beat-em-up", fighting: "fighting", boxing: "fighting", wrestling: "fighting",
	platform: "platformer", "side-scrolling": "platformer", "music-audio": "music", rhythmic: "rhythm", "interactive-story": "interactive-fiction",
	football: "football", "american-football": "football", soccer: "soccer", basketball: "basketball", golf: "golf", tennis: "sports", pool: "sports", billiards: "sports",
};
const TAG_NOISE = new Set(["browser", "browser-games", "unblocked", "pc", "cool", "great", "addictive", "easy", "fun", "1-player", "mouse", "power", "color", "ai", "artificial-intelligence", "entertainment", "3d", "2d", "flash", "classic", "webgl", "controller", "little", "crazy", "hard", "difficult", "mini", "trial", "launch", "popular-apps", "indie", "skill", "other", "cute", "funny", "cartoon", "girl", "country", "microsoft", "collect", "upgrade", "drag", "avoid", "destroy", "killing", "bloody", "great"]);

export function tagsFor(a: NowggApp, p: NowggPage | null): string[] {
	const raw = [a.appGenre ?? "", ...(p?.genres ?? []), ...(p?.subGenres ?? [])].map((t) => t.toLowerCase().trim().replace(/-games$/, ""));
	const out: string[] = [];
	for (const r of raw) {
		const t = TAG_ALIAS[r] ?? TAG_ALIAS[r.replace(/\s+/g, "-")] ?? r.replace(/\s+/g, "-");
		if (t && !TAG_NOISE.has(t) && !out.includes(t)) out.push(t);
	}
	return out;
}

export interface NowggItemOptions {
	/** public origin of the site, e.g. https://edushasta.lol — baked as the /nowgg proxy base */
	origin: string;
}

/** Map one selected now.gg game (see selectGames) to a Store item. */
export function itemFromGame(g: { app: NowggApp; page: NowggPage | null; name: string }, opts: NowggItemOptions): ImportItem {
	const { app: a, page: p, name } = g;
	const appId = String(a.appId);
	let dev = (a.appDeveloperInfo?.name || p?.developer || "").trim();
	if (/^now\.?gg\b|^nowgg/i.test(dev)) dev = "now.gg";
	else if (norm(dev) && (norm(dev) === norm(a.appName ?? "") || norm(dev) === norm(a.appSlug ?? ""))) dev = ""; // a slug standing in for a maker
	const genre = cleanText(a.appGenre || "").toLowerCase();
	const genreWord = genre && genre !== "other" ? genre.replace(/ games?$/, "") : "";
	const about = describe(p?.overview ?? "", name);
	const kind = a.appType === "Html" ? "browser" : "Android";
	const how =
		`Streams from now.gg: the game runs on a remote ${kind === "Android" ? "Android device" : "machine"} and the picture comes to the tab over WebRTC, ` +
		`so nothing is downloaded or installed. Click the picture to capture the pointer.`;
	const lead = about || `${name} is ${genreWord ? `${/^[aeiou]/.test(genreWord) ? "an" : "a"} ${genreWord}` : "a"} ${kind === "Android" ? "mobile" : "browser"} game${dev ? ` by ${dev}` : ""}.`;
	const banner = [p?.banner, p?.ogimage, a.media?.tile].find((u) => !isPlaceholder(u)) ?? undefined;
	const icon = [a.media?.icon, p?.icon].find((u) => !isPlaceholder(u)) ?? undefined;
	return {
		name,
		build: () => Promise.resolve(buildPlayerPackage(a, opts.origin, { name, cover: banner ?? null })),
		summary: summarize(lead.split("\n")[0], `${name}, streamed from the cloud.`),
		description: `${lead}\n\n${how}`,
		paragraphs: true,
		developers: dev ? [dev] : [],
		porters: [{ name: "now.gg", url: a.appPageUrl || "https://now.gg" }],
		host: { name: "now.gg", url: "https://now.gg" },
		// cloud-gaming first: tagify keeps 10, and it is what puts the game on the Cloud games shelf
		tags: ["cloud-gaming", ...tagsFor(a, p).slice(0, 6), kind === "Android" ? "android" : "html5"],
		category: "games",
		iconUrl: icon,
		bannerUrl: banner,
		notes: `Cloud game (now.gg appId ${appId}${a.appPageUrl ? `, ${a.appPageUrl}` : ""}). Runs on its own origin; the stream comes over WebRTC, the control plane through the site's /nowgg proxy.`,
		source: "nowgg",
	};
}
