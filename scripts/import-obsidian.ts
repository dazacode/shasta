#!/usr/bin/env bun
/**
 * Adds every game in Obsidian's (github.com/titaniumnetwork-dev/Obsidian) live catalogue to the Shasta Store as a
 * linked app, credited to the original developer and to Obsidian.
 *
 * Obsidian's own metadata (developer, description, tags, artwork) comes straight from its catalogue; games already
 * in the Store (e.g. a wasm.rip port of the same title) are skipped so the Store has no duplicate listings.
 *
 *   bun scripts/import-obsidian.ts              # publish everything to ssh://shasta
 *   bun scripts/import-obsidian.ts --only Celeste
 *   bun scripts/import-obsidian.ts --dry
 *
 * Flash and emulated entries link to Obsidian's own player page; HTML entries link straight at the hosted build.
 */
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const SITE = "https://playobsidian.com";
const CATALOG = `${SITE}/api/catalog`;

interface CatalogGame {
	id: string;
	title: string;
	developer: string;
	description: string;
	type: "HTML" | "Flash" | "Emulation";
	tags?: string[];
	version?: string;
	internalVersion?: string;
	path?: string;
	emulator?: string;
	rom?: string;
	featured?: boolean;
	hidden?: boolean;
}

// Obsidian emulator id -> EmulatorJS core (mirrors src/lib/emulators.js)
const CORE: Record<string, string> = { "nintendo-64": "n64", "gameboy-advance": "gba", psp: "psp", playstation: "psx", nes: "nes", snes: "snes", "gameboy": "gb", "gameboy-color": "gbc", "sega-master-system": "segaMD", "game-gear": "segaMD", "virtual-boy": "vb", "atari-2600": "a2600", "atari-5200": "a5200", "atari-7800": "a7800", "atari-lynx": "lynx", "atari-jaguar": "jaguar", "turbografx-16": "pce", "neo-geo-pocket": "ngp", "neo-geo-pocket-color": "ngp", "wonderswan": "ws", "sega-saturn": "yabause", "colecovision": "coleco" };

function gameUrl(g: CatalogGame): string | null {
	const ver = g.version || g.internalVersion || "1";
	if (g.type === "HTML") return `${SITE}/cdn/assets/html/${g.id}/${ver}${g.path ?? "/index.html"}`;
	if (g.type === "Flash") return `${SITE}/flash/cdn/assets/flash/${g.id}/${ver}/${g.id}.swf`;
	if (g.type === "Emulation" && g.emulator && g.rom) return `${SITE}/emu/${CORE[g.emulator] ?? g.emulator}/cdn/assets/emulation/${g.id}/${ver}${g.rom.startsWith("/") ? g.rom : `/${g.rom}`}`;
	return null;
}

const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

/** the catalogue endpoint 500s now and then; a cached retry gets it */
async function fetchCatalog(): Promise<CatalogGame[]> {
	for (let i = 0; i < 6; i++) {
		try {
			const r = await fetch(CATALOG);
			const data = await r.json();
			if (Array.isArray(data)) return data as CatalogGame[];
		} catch {}
		await Bun.sleep(400);
	}
	throw new Error(`could not load ${CATALOG}`);
}

const catalog = await fetchCatalog();
const items: ImportItem[] = [];
for (const g of catalog) {
	if (g.hidden) continue;
	const url = gameUrl(g);
	if (!url) continue;
	const developer = g.developer.trim();
	items.push({
		name: g.title,
		url: encodeURI(url),
		summary: summarize(g.description, g.title),
		description: g.description.trim(),
		developers: [developer],
		host: { name: "Obsidian", url: SITE },
		tags: g.tags ?? [],
		category: "games",
		iconUrl: `${SITE}/cdn/assets/assets/${g.id}/icon.webp`,
		bannerUrl: `${SITE}/cdn/assets/assets/${g.id}/cover.webp`,
		notes: "Found on Obsidian, a browser game library.",
		source: "obsidian",
	});
}

console.log(`${items.length} Obsidian game${items.length === 1 ? "" : "s"}`);
await runImport(items, { dry: argv.includes("--dry"), only: opt("only") });
