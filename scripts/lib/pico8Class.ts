// Turns a PICO-8 cartridge's Lexaloffle BBS tags into the tags the Store shows, and names the shelves it lands on.
// The BBS tags are the author's own words ("platformer", "shooter", "roguelike", "cartridge", "wip", ...): the ones
// that name a genre are put first so the tag cap never drops them, the medium words are cleaned away, and every cart
// carries a `pico8` tag (its own "PICO-8" shelf in services/genres.ts). Pure, so scripts/import-pico8.ts and the
// test agree; output tags feed server/src/services/genres.ts.
import { genresOf } from "../../server/src/services/genres";

/** the hidden source marker of scripts/import-pico8.ts (the site the carts come from) */
export const PICO8_SOURCE = "lexaloffle";

/** the visible tag every cart carries; maps to the "PICO-8" genre */
export const PICO8_TAG = "pico8";

// author tags that only say "this is a cart" or name a build state, not a kind of game
const NOISE = new Set(["cartridge", "cart", "cartridges", "pico8", "pico-8", "cart-jam", "wip", "work-in-progress", "demo", "beta", "alpha", "update", "game", "p8"]);

const MAX_VISIBLE = 9; // the server takes 10 tags; one slot is the source marker

const clean = (t: string) =>
	t
		.toLowerCase()
		.trim()
		.replace(/[\s_]+/g, "-")
		.replace(/[^\p{L}\p{N}-]/gu, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 24);

/** the visible tags a cart should carry: `pico8`, then the author's genre tags, then the rest, at most 9 */
export function pico8Tags(raw: string[]): string[] {
	const uniq: string[] = [];
	for (const t of raw ?? []) {
		const c = clean(String(t));
		if (c && !uniq.includes(c)) uniq.push(c);
	}
	const genre = uniq.filter((t) => genresOf([t]).length);
	const rest = uniq.filter((t) => !genre.includes(t) && !NOISE.has(t));
	return [...new Set([PICO8_TAG, ...genre, ...rest])].slice(0, MAX_VISIBLE);
}
