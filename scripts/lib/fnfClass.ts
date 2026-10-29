/**
 * Tells a real Friday Night Funkin' mod apart from everything else the FNF portals host (fnfgo and fnfmods.io also
 * list .io shooters, Fireboy & Watergirl, mahjong, racing games and hundreds of Sprunki mixers). Only FNF goes to
 * Music & rhythm as FNF; Sprunki stays a music game under its own tag; any other game gets the genre tags its name
 * points to, so it lands in Action, Racing, Puzzle, ... instead.
 *
 * Decided from the name and the game's embed URL only (what the import has, and what /api/dev/apps?brief=1 returns).
 */

export type FnfKind = "fnf" | "sprunki" | "other";

/** the hidden source marker of scripts/import-fnf.ts (was "fnf" before 2026-10-29, which is now a content tag) */
export const FNF_SOURCE = "fnfportal";
export const FNF_TAGS = ["rhythm", "music", "fnf", "friday-night-funkin", "fan-game"];

const FNF_NAME = /\bfnf\b|friday\s*night\s*funk|\bfunkin\b|\bfunki\b|super friday night/i;
const SPRUNKI_NAME = /spr[ui]nk|sprinkle|spruted|sprunbox|fiddlesprunk|\bincredibox\b/i;
// mod hosts that carry nothing but FNF (wowtbc.net is the Sprunki CDN, gamedistribution/gamemonetize carry anything)
const FNF_HOST = /(^|\.)(fnfhub\.net|fnfcdn\.com|fnf\.kdata1\.com|run3\.io|fnfans\.com|ppkig\.com)$/i;

const host = (url: string) => {
	try {
		return new URL(url).hostname;
	} catch {
		return "";
	}
};

export function fnfKind(name: string, url: string): FnfKind {
	if (FNF_NAME.test(name)) return "fnf";
	if (SPRUNKI_NAME.test(name)) return "sprunki";
	if (FNF_HOST.test(host(url))) return "fnf";
	return "other";
}

// name words -> genre tags (server/src/services/genres.ts maps those to genres); first match per genre is enough
const RULES: [RegExp, string[]][] = [
	[/music|piano|guitar|\bbeat|\bsongs?\b|headphone|rhythm|\btiles\b|geometry|geo dash|neon dash|dash lite/i, ["rhythm", "music"]],
	[/\.io\b|\bio$|royale|\b2p\b|2 player|multiplayer|krunker|skribbl|shell shockers|little big snake|tanki|goodgame|bloxd|worms? zone|wormax|orion stars/i, ["multiplayer"]],
	[/shoot|\bgun|sniper|\bfps\b|fight|battle|\bwar|brawl|zombi|stickman|ninja|hero|agent|duel|boxing|\bkill|mayhem|strike|spear|thor|avengers|spider|black panther|ant-man|bomb it|surviv|apocalypse|pirate|punch|naruto|arena|covered ops|ragdoll/i, ["action"]],
	[/drift|racing|\brace|racer|\bcars?\b|moto|bike|truck|taxi|parking|driver|rally|wheels|kart|traffic|curvy road|earn to die|stunt|offroad|riders/i, ["racing"]],
	[/soccer|football|basketball|dunk|golf|ping pong|billiards|8 ball|free kick|tennis|skiing|toon cup|tap tap shots/i, ["sports"]],
	[/puzzle|mahjong|2048|match|woodoku|bejeweled|quiz|wordle|worldle|trivia|escape|jigsaw|four in a row|trap the cat|thief|happy glass|blocks|\btile|merge|memory|rope slash|hero rescue|tetris|sudoku|brain|money movers|trollface|hardest game|brick breaker/i, ["puzzle"]],
	[/tycoon|idle|farming|simulat|business|empire|\bmart\b|bitlife|fashion|makeover|wedding|craft|minecraft|\bmine|planner|food empire|sandbox|cross stitch|pop stars?|queen of pop|lofi room/i, ["simulation"]],
	[/horror|scary|monster|huggy|huggie|hugie|poppy|grandma|dracula|herobrine|halloween|dead zed|five nights|freddy/i, ["horror"]],
	[/dynamons/i, ["rpg"]],
	[/fireboy|watergirl|platform|parkour|jump|climb|mario|sonic|oliver world|level devil|bob the robber|hand over hand|iron snout/i, ["platformer"]],
	[/defen[cs]e|kingdom rush|clash|galaxy|lordz|castle|tower|chess|strategy|dynast|taming/i, ["strategy"]],
	[/clicker|slope|\bdash|runner|\brun\b|helix|snake|worm|dino|flip|bounc|\bball|pop it|stack|\brush|flappy|\bbird|fly or die|timberman|switch|curve|cube|neon|hole/i, ["arcade"]],
];

/** the visible tags (no source marker) an app imported from the FNF portals should carry */
export function fnfTags(name: string, url: string): string[] {
	const kind = fnfKind(name, url);
	if (kind === "fnf") return [...FNF_TAGS];
	if (kind === "sprunki") return ["music", "sprunki", "incredibox-mod", "fan-game"];
	const tags = RULES.filter(([re]) => re.test(name)).flatMap(([, t]) => t);
	return tags.length ? [...new Set(tags)] : ["arcade", "casual"];
}
