#!/usr/bin/env bun
/**
 * Adds the entries of the "Ultimate Catalog of Web Game Ports" (github.com/Carter54git) that point at a playable
 * build, to the Shasta Store as linked apps. It is a directory, so metadata (blurb, image) is read from each play
 * page's Open Graph tags; the source site is credited as host.
 *
 * Hosts already imported wholesale (gn-math.dev) are skipped here and come from their own script; everything else,
 * including the gn-math.github.io mirror rows (served from the genizy repo via statically.io) and the wasm.rip rows
 * (deduped against the wasm.rip import by name) is imported. A row whose host does not answer is still listed.
 *
 *   bun scripts/import-webports.ts [--dry] [--pending] [--limit 50] [--jobs 8]
 */
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const README = "https://raw.githubusercontent.com/Carter54git/Ultimate-Catalog-Of-Web-Game-Ports/main/README.md";
// gn-math.dev (whole site dead 2026-10-31) is covered wholesale by the gn-math importer and its rows would each wait
// out a 20 s timeout here, so they are left to that script. Everything else — the gn-math.github.io mirror rows, the
// wasm.rip rows (deduped against the wasm.rip import by name) and one web.archive.org snapshot — is imported here.
const SKIP_HOSTS = /(^|\.)gn-math\.dev$/i;

// gn-math.github.io is dead (project Pages gone), and its "web-port" tree is the genizy/web-port repo; jsDelivr blocks
// that user, so serve it from statically.io instead. A few catalogue dirs are actually sub-apps (or the row names a
// different game than the dir), fixed here (key = the last path segment in the catalogue link).
const GENIZY_MIRROR = "https://cdn.statically.io/gh/genizy/web-port/main";
const GENIZY_FIX: Record<string, string> = {
	fnaf: "https://cdn.jsdelivr.net/gh/freebuisness/html@main/38-fix2.html", // no fnaf dir in the repo; this is FNAF
	"fears-to-fathom": `${GENIZY_MIRROR}/fears-to-fathom/home-alone/index.html`,
	kindergarten: `${GENIZY_MIRROR}/kindergarten/1/index.html`, // the row is "Kindergarten 1 & 2"
};
const resolvePlay = (play: string): string => {
	let u: URL;
	try {
		u = new URL(play);
	} catch {
		return play;
	}
	if (u.hostname === "gn-math.github.io") {
		const dir = u.pathname.split("/").filter(Boolean).pop();
		if (dir) return GENIZY_FIX[dir] ?? `${GENIZY_MIRROR}/${dir}/index.html`;
	}
	return play;
};
// The catalogue points a couple of entries at addresses that have since moved, or at a duplicate row the name-dedupe
// below keeps instead of the working one. Correct them here so a re-run stays right (key = the app name it imports).
const OVERRIDES: Record<string, { url: string; developer?: string; porters?: { name: string; url?: string }[]; host?: { name: string; url: string }; summary?: string; description?: string; tags?: string[] }> = {
	// the catalogue has both vel.gg/bo1z (451s, the row imported) and vel.gg/bsz (live); dedupe keeps the first
	"call of duty: black ops zombies": {
		url: "https://vel.gg/bsz",
		summary: "Black Ops 1's Zombies mode decompiled and running in your browser — all 10 maps, no game files.",
		description:
			"Call of Duty: Black Ops's Zombies mode runs in a browser tab, on a decompiled WebAssembly build of the original engine. All 10 maps — Kino der Toten, Five, Der Riese, Nacht der Untoten, Verrückt, Shi No Numa, Ascension, Call of the Dead, Shangri-La and Moon — with wall buys, the Mystery Box, Pack-a-Punch and Hell mode. No copy of the game is needed; each map downloads its own data the first time you play. Fan port, not affiliated with Treyarch or Activision.",
		tags: ["zombies", "fps", "shooter", "survival", "multiplayer", "horror"],
		developer: "Treyarch",
		porters: [{ name: "MisaDev4" }],
		host: { name: "vel.gg", url: "https://vel.gg/" },
	},
	// global-terror.net is a Shopify storefront now; the game runs on the project's worker host
	"skate × rust (global terror)": {
		url: "https://global-terror-skate-rust.fvc3less.workers.dev/full.html",
		summary: "Skate 3 tricks on the Modern Warfare 2 map Rust — skate the tower, or grab a gun and fight bots.",
		description:
			"Skateboarding on the Modern Warfare 2 map Rust: push, ollie, grab and grind around the tower — or switch to a first-person gun and fight bots. A single-player browser mashup built on the 2010 Rust Rewrite project, needing a keyboard and mouse on desktop. The host may ask for a quick sign-in before it starts.",
		tags: ["skateboarding", "sports", "shooter", "action", "mashup"],
		developer: "Global-terror",
		porters: [{ name: "chasmlol", url: "https://github.com/chasmlol/2010-rust-rewrite-mashup" }],
		host: { name: "global-terror-skate-rust.fvc3less.workers.dev", url: "https://global-terror-skate-rust.fvc3less.workers.dev/" },
	},
};
const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const limit = Number(opt("limit")) || Infinity;

const md = await (await fetch(README)).text();
const rows = md
	.split("\n")
	.filter((l) => /^\|/.test(l))
	.map((l) => l.split("|").map((s) => s.trim()))
	.filter((c) => c.length >= 5 && c[1] && !/^-+$/.test(c[1]) && c[1] !== "Game");

interface Row {
	name: string;
	url: string;
}
const seen = new Set<string>();
const found: Row[] = [];
for (const c of rows) {
	const play = /\((https?:[^)]+)\)/.exec(c[2])?.[1];
	if (!play) continue;
	let host: string;
	try {
		host = new URL(play).hostname;
	} catch {
		continue;
	}
	if (SKIP_HOSTS.test(host)) continue;
	const name = c[1].replace(/^[⭐▶\s]+/, "").replace(/\s*\(\d+\)$/, "").replace(/\s+/g, " ").trim();
	if (!name || name.length < 2 || seen.has(name.toLowerCase())) continue;
	seen.add(name.toLowerCase());
	found.push({ name, url: OVERRIDES[name.toLowerCase()]?.url ?? resolvePlay(play) });
	if (found.length >= limit) break;
}
console.log(`${found.length} catalogue entries with a direct play link`);

const prettyHost = (host: string) => {
	const label = host.replace(/^www\./, "").split(".")[0];
	return label.charAt(0).toUpperCase() + label.slice(1);
};

const scrape = async (r: Row): Promise<ImportItem | null> => {
	const host = new URL(r.url).hostname.replace(/^www\./, "");
	const override = OVERRIDES[r.name.toLowerCase()];
	// the gn-math.github.io rows are now served from the genizy/web-port mirror; credit that repo, not the CDN, and
	// leave the maker credit empty (the catalogue row does not name one) rather than inventing "Cdn"
	const mirrored = host === "cdn.statically.io" || host === "cdn.jsdelivr.net";
	const creditHost = mirrored ? { name: "genizy/web-port", url: "https://github.com/genizy/web-port" } : { name: host, url: `https://${host}` };
	const creditDev = override?.developer ? [override.developer] : mirrored ? [] : [prettyHost(host)];
	try {
		const html = await (await fetch(r.url, { signal: AbortSignal.timeout(20000) })).text();
		const meta = (p: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i").exec(html)?.[1];
		const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1];
		const image = meta("og:image") || meta("twitter:image");
		const blurb = (meta("og:description") || meta("description") || "").replace(/\s+/g, " ").trim();
		void title;
		const description = override?.description ?? (blurb.length >= 20 ? blurb.slice(0, 1000) : `${r.name}, a browser port playable at ${host}.`);
		return {
			name: r.name.slice(0, 60),
			url: r.url,
			summary: override?.summary ?? summarize(blurb || description, r.name),
			description,
			developers: creditDev,
			porters: override?.porters,
			host: override?.host ?? creditHost,
			tags: override?.tags ?? ["port", "browser"],
			category: "games",
			iconUrl: image,
			bannerUrl: image,
			notes: `Found in the Ultimate Catalog of Web Game Ports (${host}).`,
			source: "webports",
		};
	} catch {
		// the host is unreachable right now (dead DNS, timeout, parked domain): still list the entry so the catalogue
		// is complete, with metadata built from the row alone. A later re-run upgrades it once the host answers.
		const description = override?.description ?? `${r.name}, a browser port listed in the Ultimate Catalog of Web Game Ports and playable at ${host}.`;
		return {
			name: r.name.slice(0, 60),
			url: r.url,
			summary: override?.summary ?? summarize(description, r.name),
			description,
			developers: creditDev,
			porters: override?.porters,
			host: override?.host ?? creditHost,
			tags: override?.tags ?? ["port", "browser"],
			category: "games",
			notes: `Found in the Ultimate Catalog of Web Game Ports (${host}); its host did not answer at import time.`,
			source: "webports",
		};
	}
};

let i = 0;
const out: (ImportItem | null)[] = new Array(found.length);
await Promise.all(
	new Array(Math.min(8, found.length)).fill(0).map(async () => {
		while (i < found.length) {
			const j = i++;
			out[j] = await scrape(found[j]);
		}
	}),
);
const items = out.filter((x): x is ImportItem => !!x);
console.log(`${items.length} entries with metadata`);
await runImport(items, { dry: argv.includes("--dry"), only: opt("only"), jobs: Number(opt("jobs")) || 6, pending: argv.includes("--pending") });
