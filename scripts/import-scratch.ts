#!/usr/bin/env bun
/**
 * Adds the most-loved public projects on Scratch (scratch.mit.edu) to the Shasta Store as linked apps.
 *
 * Scratch has no "most popular" feed, so this pages the public search API (`mode=popular`) over a set of game-y
 * seeds, keeps the projects that clear a loves floor, and ranks them on the device — the API's order is a
 * relevance/popularity blend, not a loves sort, so it is never trusted. Each app links to TurboWarp's embed
 * (60 FPS, autoplay, gamepad, fullscreen) rather than scratch.mit.edu, so the game plays at its best; the project
 * and its author still come from Scratch, which is credited as the host.
 *
 * The API rate-limits hard (429, no Retry-After), so requests are paced and retried rather than pooled.
 *
 *   bun scripts/import-scratch.ts [--limit 400] [--min-loves 1000] [--max-offset 2000] [--dry] [--only Celeste] [--jobs 6]
 */
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const API = "https://api.scratch.mit.edu/search/projects";
const HOST = { name: "Scratch", url: "https://scratch.mit.edu" };
const PORTER = { name: "TurboWarp", url: "https://turbowarp.org" };

const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const limit = Number(opt("limit")) || 400;
const minLoves = Number(opt("min-loves")) || 1000;
const maxOffset = Number(opt("max-offset")) || 2000;

// Game-y seeds: each is paged until results fall under the loves floor. Broad terms surface the all-timers,
// narrow ones pull in genres the broad terms miss.
const SEEDS = [
	"game", "platformer", "minecraft", "3d", "rpg", "tower defense", "clicker", "idle", "survival", "horror",
	"racing", "puzzle", "shooter", "fnaf", "among us", "pokemon", "mario", "geometry dash", "runner", "adventure",
	"simulator", "tycoon", "fighting", "multiplayer", "flappy",
];

interface ScratchProject {
	id: number;
	title: string;
	description?: string;
	instructions?: string;
	author: { username: string };
	image?: string;
	images?: Record<string, string>;
	stats: { loves: number; views: number };
}

// Tags that put a game in one of the Store's genres. Derived from the title (Scratch projects carry no tags).
const TAGS: [RegExp, string[]][] = [
	[/minecraft/i, ["sandbox", "building"]],
	[/geometry dash/i, ["rhythm", "arcade"]],
	[/platformer|mario|jump|run\b/i, ["platformer"]],
	[/clicker|incremental|idle/i, ["clicker", "idle"]],
	[/tower defense/i, ["tower-defense", "strategy"]],
	[/\brpg\b|adventure/i, ["rpg", "adventure"]],
	[/survival|zombie/i, ["survival"]],
	[/horror|fnaf|five nights/i, ["horror"]],
	[/racing|kart|drift/i, ["racing"]],
	[/puzzle|maze|sokoban/i, ["puzzle"]],
	[/shooter|shoot|space|asteroid/i, ["shooter", "arcade"]],
	[/among us|multiplayer|\bpvp\b|\bio\b/i, ["multiplayer"]],
	[/pokemon|battle|fight/i, ["action"]],
	[/simulator|tycoon|build/i, ["simulation"]],
	[/flappy|endless|runner/i, ["endless-runner", "arcade"]],
	[/quiz|trivia|math/i, ["casual"]],
];

/** Requests are paced to stay under the anonymous API rate limit; 429/5xx are retried with backoff. */
let last = 0;
const GAP = 350;
async function api<T>(url: string): Promise<T | null> {
	for (let attempt = 0; attempt < 6; attempt++) {
		const wait = GAP - (Date.now() - last);
		if (wait > 0) await Bun.sleep(wait);
		last = Date.now();
		try {
			const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
			if (r.status === 429 || r.status >= 500) {
				await Bun.sleep(1500 * (attempt + 1));
				continue;
			}
			if (!r.ok) return null;
			return (await r.json()) as T;
		} catch {
			await Bun.sleep(1000 * (attempt + 1));
		}
	}
	return null;
}

const byId = new Map<number, ScratchProject>();
const consider = (p: ScratchProject) => {
	if (!p || typeof p.id !== "number" || !p.title || !p.author?.username) return;
	if ((p.stats?.loves ?? 0) < minLoves) return;
	if (!byId.has(p.id)) byId.set(p.id, p);
};

let pages = 0;
for (const q of SEEDS) {
	for (let offset = 0; offset <= maxOffset; offset += 40) {
		const page = await api<ScratchProject[]>(`${API}?q=${encodeURIComponent(q)}&mode=popular&limit=40&offset=${offset}`);
		if (!page?.length) break;
		pages++;
		for (const p of page) consider(p);
		if (page.length < 40) break;
		if (Math.max(...page.map((p) => p.stats?.loves ?? 0)) < minLoves) break;
	}
	console.log(`  ${q}: ${byId.size} kept so far (${pages} pages)`);
}

const ranked = [...byId.values()].sort((a, b) => b.stats.loves - a.stats.loves).slice(0, limit);
console.log(`${ranked.length} Scratch projects (>= ${minLoves} loves, top ${limit} by loves)`);

// Two different projects often share a title ("Mario Game"); disambiguate the lower-ranked one so the Store keeps both.
const used = new Set<string>();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const uniqueName = (title: string, author: string) => {
	const base = title.replace(/\s+/g, " ").trim().slice(0, 60) || "Scratch project";
	if (!used.has(norm(base))) return used.add(norm(base)), base;
	const alt = `${base} (by ${author})`.slice(0, 60);
	if (!used.has(norm(alt))) return used.add(norm(alt)), alt;
	let n = 2;
	while (used.has(norm(`${alt} ${n}`))) n++;
	const out = `${alt} ${n}`.slice(0, 60);
	used.add(norm(out));
	return out;
};

const items: ImportItem[] = [];
for (const p of ranked) {
	const author = p.author.username;
	const title = p.title.replace(/\s+/g, " ").trim();
	const tags = ["game", "scratch", ...TAGS.filter(([re]) => re.test(title)).flatMap(([, t]) => t)];
	const blurb = (p.instructions || p.description || "").replace(/\s+/g, " ").trim();
	const description = `Play ${title}, a game made on Scratch by ${author} (${p.stats.loves.toLocaleString()} loves, ${p.stats.views.toLocaleString()} views).${blurb ? ` ${blurb}` : ""} It runs in the tab through TurboWarp; nothing to install.`;
	items.push({
		name: uniqueName(title, author),
		url: `https://turbowarp.org/${p.id}/embed?autoplay&fps=60&settings-button&addons=gamepad,pause`,
		summary: summarize(blurb, `A Scratch game by ${author}.`),
		description,
		developers: [author],
		porters: [PORTER],
		host: HOST,
		tags,
		category: "games",
		iconUrl: p.image ?? p.images?.["480x360"],
		bannerUrl: p.images?.["480x360"] ?? p.image,
		notes: `A Scratch project (${p.stats.loves.toLocaleString()} loves) played through TurboWarp.`,
		source: "scratch",
	});
}

await runImport(items, { dry: argv.includes("--dry"), only: opt("only"), jobs: opt("jobs") ? Number(opt("jobs")) : undefined });
