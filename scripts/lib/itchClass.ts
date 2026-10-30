/**
 * Tells a real visual novel apart from everything else itch.io files under "Visual Novel". On itch the genre is the
 * author's own pick, so the first import (which trusted it) put ~7k games on the Visual novel shelf: Bitsy walks,
 * Twine stories, first-person horror, RPG Maker games, platformers with a bit of dialogue. A visual novel is read:
 * text boxes over character art and backgrounds, maybe choices. The engine says that best (Ren'Py, TyranoBuilder,
 * Naninovel, ... exist to make exactly that), then the format tags (kinetic novel, dating sim, otome), and the
 * author's genre only when nothing else contradicts it.
 *
 * Pure: decided from what an itch page lists (genres, "Made with", tags), so scripts/import-itch.ts and
 * scripts/retag-itch.ts agree. Output tags are the ones server/src/services/genres.ts turns into shelves.
 */
import { genresOf } from "../../server/src/services/genres";

export interface ItchFacts {
	/** itch's Genre row, e.g. visual-novel, puzzle, role-playing */
	genres: string[];
	/** itch's "Made with" row */
	madeWith: string[];
	tags: string[];
}

/** the hidden source marker of scripts/import-itch.ts */
export const ITCH_SOURCE = "itch";

// engines made for visual novels (itch made-with slugs, and the same names when an author puts them in tags)
const VN_ENGINES = new Set(["renpy", "ren-py", "tyranobuilder", "tyranoscript", "tyrano", "naninovel", "visual-novel-maker", "novelty", "monogatari", "nvlmaker", "kirikiri", "webgal", "vnmaker", "light-vn", "lightvn", "videotome"]);
// engines that make something else: a walk (Bitsy), hypertext (Twine, ink), an RPG, a Game Boy game, a puzzle
const OTHER_ENGINES: Record<string, string[]> = {
	bitsy: ["exploration"],
	"bitsy-3d": ["exploration"],
	twine: ["interactive-fiction"],
	ink: ["interactive-fiction"],
	inklewriter: ["interactive-fiction"],
	"inform-7": ["interactive-fiction"],
	inform: ["interactive-fiction"],
	adrift: ["interactive-fiction"],
	"adventure-game-studio": ["point-and-click"],
	decker: ["interactive-fiction"],
	"gb-studio": ["retro"],
	"pico-8": ["retro"],
	"tic-80": ["retro"],
	pulp: ["retro"],
	puzzlescript: ["puzzle"],
	flickgame: ["exploration"],
	downpour: ["exploration"],
};
// RPG Maker makes RPGs, but plenty of hand-drawn horror visual novels are built in it too: only a hint, not a verdict
const RPG_MAKER = new Set(["rpg-maker", "rpg-maker-mv", "rpg-maker-mz", "rpg-maker-2003", "rpg-maker-vx-ace", "rpgmaker"]);
// how a visual novel tends to look (art drawn, not pixels; routes and endings), worth one point at most
const VN_LIKE_TAGS = new Set(["hand-drawn", "anime", "multiple-endings", "meaningful-choices", "choices-matter", "romance", "boys-love", "yuri", "yaoi", "amare", "josei", "shoujo"]);
// how the author says it is a visual novel, beyond the genre pick
const FORMAT_TAGS = new Set(["visual-novel", "vn", "kinetic-novel", "sound-novel", "dating-sim", "date-sim", "date-simulator", "otome", "otome-game", "galge", "eroge", "nakige", "utsuge", "bishoujo", "bishounen"]);
// itch genres (Genre row) that name another way of playing
const PLAY_GENRES = new Set(["action", "platformer", "shooter", "fighting", "racing", "rhythm", "sports", "strategy", "survival", "card-game", "puzzle", "simulation", "role-playing"]);
// tags that describe play a visual novel does not have
const PLAY_TAGS = new Set(["platformer", "2d-platformer", "3d-platformer", "puzzle-platformer", "action", "shooter", "fps", "first-person", "first-person-shooter", "third-person", "3d", "top-down", "top-down-shooter", "bullet-hell", "shoot-em-up", "metroidvania", "roguelike", "roguelite", "rhythm", "racing", "fighting", "beat-em-up", "tower-defense", "endless-runner", "arcade", "physics", "walking-simulator", "exploration", "text-based", "interactive-fiction", "twine", "bitsy", "parser", "survival", "stealth", "sandbox", "management", "clicker", "idle", "card-game", "deckbuilding", "turn-based-combat", "action-rpg", "jrpg", "dungeon-crawler", "hack-and-slash", "boss-fight", "fishing", "farming", "cooking", "sokoban", "match-3", "tetris"]);
// itch genre/tag spellings -> the tag genres.ts knows (keeps a non-VN game on a real shelf)
const ALIAS: Record<string, string> = {
	"role-playing": "rpg",
	rpgmaker: "rpg-maker",
	"rpg-maker-mv": "rpg-maker",
	"rpg-maker-mz": "rpg-maker",
	gameboy: "retro", // GB Studio homebrew: new games in an old style, not Console classics
	"game-boy": "retro",
	"pixel-art": "pixel-art",
	"point-click": "point-and-click",
	"text-based": "interactive-fiction",
	parser: "interactive-fiction",
	twine: "interactive-fiction",
	"walking-simulator": "exploration",
	"first-person-shooter": "fps",
	"top-down-shooter": "shooter",
	deckbuilding: "deckbuilder",
	"ren-py": "renpy",
};
const MAX_VISIBLE = 9; // the server takes 10 tags; one slot is the source marker

const lc = (l: string[]) => l.map((t) => t.toLowerCase().trim());

/** how sure the page is that this is a visual novel; >= 2 means it is one */
export function vnScore(f: ItchFacts): number {
	const genres = lc(f.genres);
	const made = lc(f.madeWith);
	const tags = lc(f.tags);
	const all = [...made, ...tags];
	let score = 0;
	if (all.some((t) => VN_ENGINES.has(t))) score += 4;
	else if (all.some((t) => t in OTHER_ENGINES)) score -= 4;
	else if (all.some((t) => RPG_MAKER.has(t))) score -= 1;
	if (genres.includes("visual-novel")) score += 2;
	if (genres.includes("interactive-fiction")) score -= 1;
	score += 2 * Math.min(2, new Set(tags.filter((t) => FORMAT_TAGS.has(t))).size);
	if (tags.some((t) => VN_LIKE_TAGS.has(t))) score += 1;
	score -= Math.min(2, genres.filter((g) => PLAY_GENRES.has(g)).length);
	score -= Math.min(3, new Set(tags.filter((t) => PLAY_TAGS.has(t))).size);
	return score;
}

export const isVisualNovel = (f: ItchFacts) => vnScore(f) >= 2;

/** the visible tags (no source marker) an itch.io game should carry, most telling first, at most 9 */
export function itchTags(f: ItchFacts): string[] {
	const vn = isVisualNovel(f);
	const made = lc(f.madeWith);
	const raw = [...lc(f.genres), ...lc(f.tags)];
	const out: string[] = [];
	const add = (t: string) => {
		const tag = ALIAS[t] ?? t;
		if (!tag || out.includes(tag)) return;
		// a non-VN keeps no VN-format tag, or it would be back on the shelf
		if (!vn && (FORMAT_TAGS.has(tag) || VN_ENGINES.has(tag))) return;
		if (tag === "visual-novel" || tag === "renpy") return; // placed first below
		if (vn && tag === "rpg-maker") return; // a visual novel built in RPG Maker is not an RPG
		out.push(tag);
	};
	const head: string[] = [];
	if (vn) {
		head.push("visual-novel");
		if (made.includes("renpy") || raw.includes("renpy")) head.push("renpy");
	}
	for (const m of made) for (const t of OTHER_ENGINES[m] ?? (RPG_MAKER.has(m) ? ["rpg-maker"] : [])) add(t);
	// tags that put the game on a shelf first, so the cap never drops them, then everything else in itch's order
	for (const t of raw) if (genresOf([ALIAS[t] ?? t]).length) add(t);
	for (const t of raw) add(t);
	const tags = [...head, ...out];
	// a story game that names no other genre still belongs somewhere: Adventure, as a narrative game
	if (!vn && !genresOf(tags).length) tags.splice(0, 0, "narrative");
	return [...new Set(tags)].filter((t) => /^[\p{L}\p{N}-]{1,24}$/u.test(t)).slice(0, MAX_VISIBLE);
}

/** the facts of an already imported app, from its stored tags alone (when its itch page is gone) */
export function factsFromTags(tags: string[]): ItchFacts {
	const t = lc(tags).filter((x) => x !== ITCH_SOURCE && x !== "browser");
	return {
		genres: t.includes("visual-novel") ? ["visual-novel"] : [],
		madeWith: t.filter((x) => VN_ENGINES.has(x) || x in OTHER_ENGINES || RPG_MAKER.has(x)),
		tags: t.filter((x) => x !== "visual-novel"),
	};
}
