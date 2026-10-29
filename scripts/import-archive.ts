#!/usr/bin/env bun
/**
 * Adds Internet Archive's playable game collections to the Shasta Store as linked apps.
 *
 * Each item links to its Emularity player (https://archive.org/embed/<id>); metadata (title, creator, blurb,
 * thumbnail) comes from the Archive's public scrape API. Names already in the Store are skipped, and so is clutter
 * (bad-dump variants, ROM hacks, demos): see lib/archiveClass.ts, which also picks the genres.
 *
 *   bun scripts/import-archive.ts [--collections internetarcade,consolelivingroom] [--limit 500] [--dry] [--jobs 8]
 */
import { type ArchiveDoc, classify, fetchArchive } from "./lib/archiveClass";
import { runImport, summarize, cleanText, type ImportItem } from "./lib/storeImport";

const DEFAULT_COLLECTIONS = ["internetarcade", "consolelivingroom", "softwarelibrary_msdos_games"];
const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const collections = (opt("collections") ?? DEFAULT_COLLECTIONS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const limit = Number(opt("limit")) || Infinity;

const asText = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "");

type Doc = ArchiveDoc & { creator?: string | string[]; description?: string | string[] };

const docs = (await fetchArchive(collections, ["creator", "description"], limit)) as Doc[];
console.log(`${docs.length} archive.org items`);

const items: ImportItem[] = [];
for (const d of docs) {
	const name = asText(d.title).replace(/\s+/g, " ").trim();
	if (!name || !d.identifier) continue;
	const cls = classify(d, name);
	if (cls.clutter) continue;
	const creator = asText(d.creator).replace(/\s+/g, " ").trim();
	const blurb = cleanText(asText(d.description));
	const description = blurb.length >= 20 ? blurb.slice(0, 4000) : `${name}${creator ? ` by ${creator}` : ""}, playable in the browser through the Internet Archive's emulator.`;
	const thumb = `https://archive.org/services/img/${d.identifier}`;
	items.push({
		name: name.slice(0, 60),
		url: `https://archive.org/embed/${d.identifier}`,
		summary: summarize(blurb || description, name),
		description,
		developers: creator ? [creator.slice(0, 60)] : [],
		host: { name: "Internet Archive", url: "https://archive.org" },
		tags: cls.tags,
		category: "games",
		iconUrl: thumb,
		bannerUrl: thumb,
		notes: "Runs in the Internet Archive's in-browser emulator.",
		source: "archive",
	});
}

console.log(`${items.length} archive.org games with metadata`);
await runImport(items, { dry: argv.includes("--dry"), only: opt("only"), jobs: Number(opt("jobs")) || 8 });
