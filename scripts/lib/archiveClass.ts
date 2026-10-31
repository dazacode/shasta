// Sorting Internet Archive game items into the Store's genres, from the Archive's own metadata: the sub-collection an
// item is in names its system, MAME's `genre` (Internet Arcade) and `subject` name what kind of game it is. Also says
// which items are clutter (bad-dump variants, ROM hacks, demos, items MAME marks unplayable or mature): those are
// never imported and are unpublished by `retag-archive.ts`. Flash items are their own "Flash classics" shelf (they
// ran in a browser), never a console. Shared by import-archive.ts and retag-archive.ts.

export interface ArchiveDoc {
	identifier: string;
	title?: string;
	collection?: string | string[];
	genre?: string | string[];
	subject?: string | string[];
	year?: string | number;
	/** read only for Flash items whose subjects name no kind of game */
	description?: string | string[];
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);

/** sub-collection -> platform tag (tags in services/genres.ts PLATFORM_TAGS) */
const SUB_PLATFORM: Record<string, string> = {
	sega_genesis_library: "sega-genesis",
	genesisvariations: "sega-genesis",
	sonicromhacks: "sega-genesis",
	atari_2600_library: "atari-2600",
	atari_2600_hacks: "atari-2600",
	atari_2600_demos: "atari-2600",
	psxgames: "playstation",
	atari_7800_library: "atari-7800",
	atari_7800_homebrew: "atari-7800",
	atari_7800_demos: "atari-7800",
	atari_7800_music: "atari-7800",
	sega_sms_library: "sega-master-system",
	gamegear_library: "game-gear",
	tg16_library: "turbografx",
	"wonderswan-library": "wonderswan",
	coleco_colecovision_library: "colecovision",
	ngp_library: "neo-geo-pocket",
	atari_5200_library: "atari-5200",
	intellivision: "intellivision",
	vectrex: "vectrex",
	library_magnavox_odyssey2: "odyssey2",
	sg_1000_library: "sg-1000",
	"lynx-library": "atari-lynx",
	wasm4: "fantasy-console",
	seuckgames: "c64",
};

/** whole sub-collections that are variants of other items, hacks or non-games */
const CLUTTER_SUBS = new Set(["genesisvariations", "sonicromhacks", "atari_2600_hacks", "atari_2600_demos", "atari_7800_demos", "atari_7800_music"]);

/** GoodTools/No-Intro dump codes: [h1C] hack, [p1] pirate, [b1] bad, [a1] alternate, [o1] overdump, [f1] fixed, [t1] trained, [T+Rus] translation */
const DUMP_FLAG = /\[(?:[hpbaoft]\d|T[+-])|\[(?:h|p|b|a|o|f|t)\]|\((?:[^)]*\b)?hack\)|\bhack\b|\(rus\)|\[rus\]/i;

/** platforms named in a title (for the "misc consoles" collection, which mixes systems) */
const TITLE_PLATFORM: [string, RegExp][] = [
	["gameboy-advance", /game ?boy advance|\bgba\b/i],
	["gameboy-color", /game ?boy colou?r|\bgbc\b/i],
	["gameboy", /game ?boy/i],
	["nintendo-ds", /nintendo ds|\bnds\b|\bds rom\b/i],
	["nintendo-64", /nintendo 64|\bn64\b/i],
	["gamecube", /game ?cube/i],
	["snes", /super nintendo|\bsnes\b|super famicom/i],
	["nes", /\bnes\b|famicom/i],
	["sega-genesis", /genesis|mega ?drive/i],
	["sega-master-system", /master system/i],
	["game-gear", /game ?gear/i],
	["dreamcast", /dreamcast/i],
	["sega-saturn", /\bsaturn\b/i],
	["playstation", /playstation|\bps1\b|\bpsx\b/i],
	["psp", /\bpsp\b/i],
	["turbografx", /turbografx|pc engine|supergrafx/i],
	["neo-geo", /neo ?geo/i],
];

/** words in MAME genres and Archive subjects -> genre tags (services/genres.ts) */
const KIND: [string, RegExp][] = [
	["shooter", /shoot|shmup|gallery|\bgun\b/i],
	["fighting", /fight|wrestl|boxing|beat.?em/i],
	["platformer", /platform|climbing/i],
	["sports", /sport|football|soccer|baseball|basketball|golf|tennis|hockey|bowling|pool\b|billiard/i],
	["racing", /racing|driving|\bracer\b/i],
	["puzzle", /puzzle|quiz|trivia/i],
	["rpg", /\brpg\b|role.?playing/i],
	["adventure", /adventure|interactive fiction|text game|\b(?:agi|agt|sci) games\b/i],
	["strategy", /strategy|tactic|wargame|chess/i],
	["simulation", /simulat|flight sim/i],
	["horror", /horror/i],
	["arcade", /\bmaze\b|ball & paddle|breakout|pinball/i],
];

// Flash items are tagged by their uploaders, not by MAME: looser words, read only for Flash ("arcade" on an Internet
// Arcade item means the cabinet, not "Arcade & casual").
const FLASH_KIND: [string, RegExp][] = [
	["action", /\baction\b/i],
	["arcade", /\barcade\b|score.?attack|time.?attack|\bdodge\b|mini.?game|avoid(?:er)?\b/i],
	["casual", /dress.?up|make.?a.?scene|colou?ring|make.?over|cooking/i],
	["escape", /\bescape\b/i],
	["puzzle", /jigsaw|hidden object|mahjong|sudoku|match.?3|\blogic(?:al)?\b|word game|spot the difference|matching/i],
	["point-and-click", /point.?(?:and|&|n).?click/i],
	["physics", /physics/i],
	["tower-defense", /tower.?defen[cs]e/i],
	["idle", /\bidle\b|clicker|incremental/i],
	["multiplayer", /multi.?player|\b2.?players\b|two.?player/i],
	["zombies", /zombie/i],
];

// Last resort when the subjects name no kind: unambiguous words in the title (and, for Flash, the start of the
// description, which is usually one line like "Standard matching puzzle game").
const TITLE_KIND: [string, RegExp][] = [
	["casual", /dress.?up|make.?over|\bcooking\b/i],
	["escape", /\bescape\b/i],
	["puzzle", /puzzle|jigsaw|sudoku|mahjong|\bquiz\b|trivia|tetris/i],
	["racing", /racing|\bracer\b|\brace\b|\bdrift|\bkart\b|motocross|\brally\b/i],
	["sports", /soccer|football|basketball|baseball|\bgolf|tennis|hockey|bowling|penalty|skateboard/i],
	["tower-defense", /tower.?defen[cs]e|\bdefen[cs]e\b/i],
	["shooter", /shoot|sniper|\bgun\b/i],
	["fighting", /fight|brawl|boxing|wrestl/i],
	["zombies", /zombie/i],
	["simulation", /tycoon|simulator/i],
	["horror", /horror|\bscary\b|haunted/i],
	["idle", /\bidle\b|clicker/i],
	["rpg", /\brpg\b/i],
];

// A few items in the Flash games library are cartoons, banner ads or whole saved websites, not games.
const NOT_A_GAME = /flash ?(?:animation|movie|cartoon|website|site)|^animation$|music video|banner ad/i;

export interface ArchiveClass {
	/** tags to give the app, without the import marker */
	tags: string[];
	/** why the item should not be in the Store, or null */
	clutter: string | null;
}

export function classify(doc: ArchiveDoc, name = doc.title ?? ""): ArchiveClass {
	const subs = list(doc.collection);
	const genre = list(doc.genre).join("; ");
	const words = [genre, ...list(doc.subject)].join("; ");
	const id = doc.identifier;

	const flash = subs.includes("softwarelibrary_flash_games") || subs.includes("softwarelibrary_flash");
	const arcade = !flash && (subs.includes("internetarcade") || id.startsWith("arcade_"));
	const dos = !flash && !arcade && (subs.includes("softwarelibrary_msdos_games") || subs.includes("softwarelibrary_msdos"));
	const cls = flash ? "flash-classic" : arcade ? "arcade-classic" : dos ? "dos" : "console";

	const platforms = arcade || dos || flash ? [] : [...new Set([...subs.map((s) => SUB_PLATFORM[s]).filter(Boolean), ...TITLE_PLATFORM.filter(([, re]) => re.test(name)).map(([t]) => t)])].slice(0, 2);
	const subjects = list(doc.subject).flatMap((x) => x.split(/[;,]/)).map((x) => x.trim()).filter(Boolean);
	let kinds = [...new Set([...KIND, ...(flash ? FLASH_KIND : [])].filter(([, re]) => re.test(words)).map(([t]) => t))];
	if (!kinds.length) {
		const blurb = flash ? list(doc.description).join(" ").replace(/<[^>]+>/g, " ").slice(0, 400) : "";
		const fallback = [...TITLE_KIND.filter(([, re]) => re.test(name)), ...(blurb ? [...KIND, ...FLASH_KIND, ...TITLE_KIND].filter(([, re]) => re.test(blurb)) : [])];
		kinds = [...new Set(fallback.map(([t]) => t))];
	}
	kinds = kinds.slice(0, 3);
	const n = Number(doc.year);
	const year = Number.isFinite(n) && n > 1950 && n < 2030 ? [String(n)] : [];

	const sub = subs.find((s) => CLUTTER_SUBS.has(s));
	const notGame = flash && subjects.some((x) => NOT_A_GAME.test(x)) && !subjects.some((x) => /game|jogo|juego/i.test(x));
	const clutter = sub ? `in ${sub}` : DUMP_FLAG.test(name) ? "dump variant or hack" : /unplayable|\*mature\*/i.test(genre) ? `MAME: ${genre}` : notGame ? "Flash animation or website" : null;
	return { tags: [cls, ...platforms, ...kinds, ...year].slice(0, 9), clutter };
}

/** the Archive identifier a linked app points at (https://archive.org/embed/<id>) */
export const archiveIdOf = (url: string) => url.match(/archive\.org\/embed\/([^/?#]+)/)?.[1] ?? null;

/** every item of the given collections with the fields classify() reads (the scrape API pages past 10k) */
export async function fetchArchive(collections: string[], extra: string[] = [], limit = Infinity): Promise<ArchiveDoc[]> {
	const out: ArchiveDoc[] = [];
	const fields = ["identifier", "title", "collection", "genre", "subject", "year", ...extra].join(",");
	for (const collection of collections) {
		const start = out.length;
		let cursor = "";
		for (let guard = 0; guard < 30; guard++) {
			const url = `https://archive.org/services/search/v1/scrape?q=${encodeURIComponent(`collection:${collection}`)}&fields=${fields}&count=10000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
			let j: { items?: ArchiveDoc[]; total?: number; cursor?: string } | null = null;
			for (let attempt = 0; attempt < 4 && !j; attempt++) {
				try {
					const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
					const data = (await r.json()) as { items?: ArchiveDoc[] };
					if (r.ok && Array.isArray(data?.items)) j = data;
				} catch {}
				if (!j) await Bun.sleep(600 * (attempt + 1));
			}
			if (!j?.items?.length) break;
			out.push(...j.items);
			console.log(`  ${collection}: ${out.length - start}${j.total ? `/${j.total}` : ""}`);
			if (out.length - start >= limit || !j.cursor) break;
			cursor = j.cursor;
		}
	}
	return out;
}
