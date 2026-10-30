#!/usr/bin/env bun
// Probes the streaming sources Shasta Watch would play from: reachability, whether a host may be
// embedded (X-Frame-Options / frame-ancestors), and — for facades — the player it frames. Sources
// churn, so run this before trusting docs/streaming-sources.md. Nothing here touches the app.
//
//   bun run media:probe            # table
//   bun run media:probe --json     # machine-readable (for /check or CI)
//   bun run media:probe --only vidsrc
//
// Exit code is 1 when fewer than --min (default 2) embed sources answer, so it can gate a release.

type Kind = "movie-embed" | "tv-embed" | "anime-embed" | "anime-resolver" | "metadata";

interface Target {
	id: string;
	kind: Kind;
	url: string;
	/** a marker that should appear in a healthy body (case-insensitive) */
	expect?: RegExp;
}

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

// Known-title ids so every probe is comparable.
const TMDB_MOVIE = 550; // Fight Club
const TMDB_TV = 1399; // Game of Thrones
const ANILIST = 21; // One Piece

const TARGETS = [
	// movies / TV — iframe embeds keyed by TMDB id
	{ id: "vidsrc.to", kind: "movie-embed", url: `https://vidsrc.to/embed/movie/${TMDB_MOVIE}` },
	{ id: "vidsrc.to tv", kind: "tv-embed", url: `https://vidsrc.to/embed/tv/${TMDB_TV}/1/1` },
	{ id: "vidsrc.net", kind: "movie-embed", url: `https://vidsrc.net/embed/movie?tmdb=${TMDB_MOVIE}` },
	{ id: "vidsrc.net tv", kind: "tv-embed", url: `https://vidsrc.net/embed/tv?tmdb=${TMDB_TV}&season=1&episode=1` },
	{ id: "2embed.cc", kind: "movie-embed", url: `https://www.2embed.cc/embed/${TMDB_MOVIE}`, expect: /iframe|player/i },
	{ id: "2embed.cc tv", kind: "tv-embed", url: `https://www.2embed.cc/embedtv/${TMDB_TV}&s=1&e=1` },
	{ id: "multiembed.mov", kind: "movie-embed", url: `https://multiembed.mov/?video_id=${TMDB_MOVIE}&tmdb=1` },
	{ id: "vidlink.pro", kind: "movie-embed", url: `https://vidlink.pro/movie/${TMDB_MOVIE}`, expect: /jwplayer|player|iframe/i },
	{ id: "vidlink.pro tv", kind: "tv-embed", url: `https://vidlink.pro/tv/${TMDB_TV}/1/1` },
	{ id: "embed.su", kind: "movie-embed", url: `https://embed.su/embed/movie/${TMDB_MOVIE}` },
	{ id: "autoembed.cc", kind: "movie-embed", url: `https://autoembed.cc/embed/movie/${TMDB_MOVIE}` },
	{ id: "moviesapi.club", kind: "movie-embed", url: `https://moviesapi.club/movie/${TMDB_MOVIE}` },
	{ id: "smashy.stream", kind: "movie-embed", url: `https://player.smashy.stream/movie/${TMDB_MOVIE}` },
	{ id: "videasy.net", kind: "movie-embed", url: `https://videasy.net/embed/movie/${TMDB_MOVIE}` },
	// anime embeds — AniList id, no TMDB needed
	{ id: "vidsrc.net anime", kind: "anime-embed", url: `https://vidsrc.net/embed/anime?anilist=${ANILIST}&episode=1` },
	// anime resolvers (public instances — often down; self-host is the real answer)
	{ id: "consumet", kind: "anime-resolver", url: "https://api.consumet.org/anime/gogoanime/naruto" },
	{ id: "consumet-vercel", kind: "anime-resolver", url: "https://consumet-api.vercel.app/anime/gogoanime/naruto", expect: /json|\{/i },
	{ id: "anify", kind: "anime-resolver", url: `https://api.anify.tv/info/${ANILIST}` },
	// metadata — all keyless, must stay up
	{ id: "anilist", kind: "metadata", url: "https://graphql.anilist.co", post: true },
	{ id: "kitsu", kind: "metadata", url: "https://kitsu.io/api/edge/anime?filter%5Btext%5D=frieren&page%5Blimit%5D=1", expect: /frieren/i },
	{ id: "tvmaze", kind: "metadata", url: "https://api.tvmaze.com/search/shows?q=breaking+bad", expect: /breaking bad/i },
	{ id: "anizip", kind: "metadata", url: `https://api.ani.zip/mappings?anilist_id=${ANILIST}`, expect: /episodes|mappings/i },
] as (Target & { post?: boolean })[];

interface Result {
	id: string;
	kind: Kind;
	ok: boolean;
	status: number;
	finalUrl: string;
	bytes: number;
	xfo: string | null;
	frameAncestors: string | null;
	framable: boolean | null;
	framesTo: string | null;
	note: string;
}

function hdr(headers: Headers, name: string): string | null {
	const v = headers.get(name);
	return v ? v.slice(0, 120) : null;
}

async function probe(t: Target & { post?: boolean }): Promise<Result> {
	const base: Result = { id: t.id, kind: t.kind, ok: false, status: 0, finalUrl: "", bytes: 0, xfo: null, frameAncestors: null, framable: null, framesTo: null, note: "" };
	let res: Response;
	try {
		res = await fetch(t.url, {
			redirect: "follow",
			signal: AbortSignal.timeout(20_000),
			headers: { "user-agent": UA, accept: "text/html,application/json,*/*" },
			...(t.post ? { method: "POST", body: JSON.stringify({ query: "{Media(id:21){id title{romaji}}}" }), headers: { "user-agent": UA, "content-type": "application/json" } as Record<string, string> } : {}),
		});
	} catch (e) {
		base.note = (e as Error).name === "TimeoutError" ? "timeout" : "unreachable (DNS/conn)";
		return base;
	}
	const xfo = hdr(res.headers, "x-frame-options");
	const csp = res.headers.get("content-security-policy") ?? "";
	const fa = /frame-ancestors([^;]*)/i.exec(csp)?.[1]?.trim() ?? null;
	base.status = res.status;
	base.finalUrl = res.url;
	base.xfo = xfo;
	base.frameAncestors = fa;
	base.framable = !xfo || /allowall|all/i.test(xfo) ? true : /deny|sameorigin/i.test(xfo) ? false : null;

	const text = await res.text().catch(() => "");
	base.bytes = text.length;
	base.ok = res.ok && (!t.expect || t.expect.test(text)) && !/^\s*<!doctype html>\s*<html[^>]*>\s*<head>\s*<title>\s*404/i.test(text);

	// for an embed facade, find the player it actually frames
	if (t.kind.endsWith("embed")) {
		const m = /<iframe[^>]+src=["']([^"']+)["']/i.exec(text);
		if (m) base.framesTo = m[1].slice(0, 120);
	}
	if (!base.ok) base.note = base.note || `status ${res.status}`;
	return base;
}

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "";
const json = process.argv.includes("--json");
const min = Number(process.env.MIN_OK ?? 2);

const targets = TARGETS.filter((t) => !only || t.id.toLowerCase().includes(only.toLowerCase()));
if (!targets.length) targets.push(...TARGETS);

const results = await Promise.all(targets.map(probe));
results.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

const embeds = results.filter((r) => r.kind.endsWith("embed"));
const okEmbeds = embeds.filter((r) => r.ok);
const blocked = embeds.filter((r) => r.framable === false);

if (json) {
	console.log(JSON.stringify({ at: new Date().toISOString(), okEmbeds: okEmbeds.length, blocked, results }, null, 2));
} else {
	const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
	console.log(`\nmedia probes — ${new Date().toISOString()}\n`);
	let lastKind = "";
	for (const r of results) {
		if (r.kind !== lastKind) {
			console.log(`\n  ${r.kind}`);
			lastKind = r.kind;
		}
		const mark = r.ok ? "ok  " : "FAIL";
		const frame = r.framable === false ? "NOT-EMBEDDABLE" : r.framesTo ? `→ frames ${r.framesTo.replace(/^https?:\/\//, "").slice(0, 48)}` : "";
		console.log(`    ${mark} ${pad(r.id, 20)} ${pad(String(r.status), 4)} ${pad(r.bytes + "b", 9)} ${r.note || frame}`);
	}
	console.log(`\n  ${okEmbeds.length}/${embeds.length} embed sources answered; ${blocked.length} refuse framing (they must be opened in a tab, not an iframe).`);
}

process.exit(okEmbeds.length >= (only ? 1 : min) ? 0 : 1);

export {};
