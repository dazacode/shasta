#!/usr/bin/env bun
/**
 * Adds the entries of the "Ultimate Catalog of Web Game Ports" (github.com/Carter54git) that point at a playable
 * build, to the Shasta Store as linked apps. It is a directory, so metadata (blurb, image) is read from each play
 * page's Open Graph tags; the source site is credited as host.
 *
 * Hosts already imported wholesale (gn-math, wasm.rip, archive.org) are skipped here and come from their own script.
 *
 *   bun scripts/import-webports.ts [--dry] [--limit 50] [--jobs 8]
 */
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const README = "https://raw.githubusercontent.com/Carter54git/Ultimate-Catalog-Of-Web-Game-Ports/main/README.md";
const SKIP_HOSTS = /(^|\.)(gn-math\.dev|gn-math\.github\.io|wasm\.rip|archive\.org)$/i;
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
	found.push({ name, url: play });
	if (found.length >= limit) break;
}
console.log(`${found.length} catalogue entries with a direct play link`);

const prettyHost = (host: string) => {
	const label = host.replace(/^www\./, "").split(".")[0];
	return label.charAt(0).toUpperCase() + label.slice(1);
};

const scrape = async (r: Row): Promise<ImportItem | null> => {
	const host = new URL(r.url).hostname.replace(/^www\./, "");
	try {
		const html = await (await fetch(r.url, { signal: AbortSignal.timeout(20000) })).text();
		const meta = (p: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i").exec(html)?.[1];
		const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1];
		const image = meta("og:image") || meta("twitter:image");
		const blurb = (meta("og:description") || meta("description") || "").replace(/\s+/g, " ").trim();
		void title;
		const description = blurb.length >= 20 ? blurb.slice(0, 1000) : `${r.name}, a browser port playable at ${host}.`;
		return {
			name: r.name.slice(0, 60),
			url: r.url,
			summary: summarize(blurb || description, r.name),
			description,
			developers: [prettyHost(host)],
			host: { name: host, url: `https://${host}` },
			tags: ["port", "browser"],
			category: "games",
			iconUrl: image,
			bannerUrl: image,
			notes: `Found in the Ultimate Catalog of Web Game Ports (${host}).`,
			source: "webports",
		};
	} catch {
		return null;
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
await runImport(items, { dry: argv.includes("--dry"), only: opt("only"), jobs: Number(opt("jobs")) || 6 });
