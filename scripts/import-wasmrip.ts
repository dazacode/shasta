#!/usr/bin/env bun
/**
 * Adds every port from https://wasm.rip/ to the Shasta Store as a linked app.
 *
 * wasm.rip is a group that ports PC games to the browser. Each port becomes a linked app in the Official
 * storefront, credited to the original developer, the person who ported it (with their GitHub) and wasm.rip.
 * Thumbnails from the site become the icon (cropped square) and the banner screenshot.
 *
 *   bun scripts/import-wasmrip.ts                 # publish everything to ssh://shasta
 *   bun scripts/import-wasmrip.ts --only Cuphead  # one game (name substring)
 *   bun scripts/import-wasmrip.ts --dry           # list what would happen, no writes
 *
 * Games already in the Store (e.g. imported from another library) are left alone. Re-running updates ours.
 */
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const SITE = "https://wasm.rip";

// Metadata the site does not carry (checked against Steam / Wikipedia / press); developer and porters are never invented.
interface Entry {
	name?: string;
	/** site thumbnail to use when games.json points at a missing file */
	image?: string;
	developer: string[];
	/** wasm.rip member names responsible for the port */
	porters: string[];
	tags: string[];
	description: string;
}
const META: Record<string, Entry> = {
	"Bendy and the Ink Machine": { developer: ["Joey Drew Studios"], porters: ["crackers", "slqnt"], tags: ["horror", "first-person"], description: "Step into the abandoned Joey Drew animation studio and find out why its cartoon star, Bendy, still moves. A first-person puzzle-horror adventure with a hand-drawn 1930s look." },
	MiSide: { developer: ["AIHASTO"], porters: ["crackers"], tags: ["horror", "indie"], description: "A dating sim that turns unsettling: you are drawn into the phone of a girl named Mita, and the cozy apartment she lives in has rules of its own. A short, twisty meta-horror game." },
	"Baldi's Basics Birthday Bash": { developer: ["Basically, Games!"], porters: ["crackers"], tags: ["horror", "retro"], description: "The birthday-themed edition of Baldi's Basics. Collect the notebooks, survive the school and dodge the party hats. Retro, deliberately odd and short." },
	"Boil Noodles at Night": { developer: ["arydk"], porters: ["sexyplankton"], tags: ["horror", "indie"], description: "A little PS1-style horror about a midnight snack. You only wanted noodles, but the trip to the shop and back turns tense. Short, atmospheric and made by one person." },
	Cuphead: { developer: ["StudioMDHR"], porters: ["crackers"], tags: ["action", "boss-rush"], description: "A run-and-gun boss rush drawn to look like a 1930s cartoon, with punishing fights and a jazz soundtrack. You play as Cuphead or Mugman, and the devil is owed a debt." },
	"Cheese Rolling": { developer: ["The Interviewed"], porters: ["sexyplankton"], tags: ["multiplayer", "physics"], description: "A ragdoll take on Gloucestershire's Cooper's Hill cheese roll. Chase a wheel of cheese down a steep hill with up to eight players and try to stay on your feet." },
	"Brotato Paws n' Claws": { developer: ["Blobfish"], porters: ["dude"], tags: ["roguelike", "arena"], description: "The Paws n' Claws update to Brotato: a top-down arena roguelike where you survive waves with up to six weapons and a growing pile of items. This build adds pets and the Beast Master." },
	"One Shot: World Machine Edition": { name: "OneShot: World Machine Edition", developer: ["Future Cat LLC"], porters: ["shayder"], tags: ["adventure", "puzzle"], description: "A story-driven puzzle adventure in which the world knows you are playing it. Guide Niko and the lightbulb through a dying world, up to a tower that holds the sun." },
	Helltaker: { developer: ["vanripper"], porters: ["shxyder"], tags: ["puzzle", "free"], description: "A free puzzle game about a sharp-dressed demon hunter building a harem from hell. Short, funny and brutal, with a great soundtrack and a sokoban-style grid to solve." },
	"Stardew Valley": { developer: ["ConcernedApe"], porters: ["cirsius"], tags: ["farming", "sandbox"], description: "Farm, fish, mine and befriend the townsfolk of Pelican Town. An open-ended life sim where you rebuild your grandfather's farm and slowly make it your own." },
	"Dice A Million": { developer: ["countlessnights"], porters: ["NotRexed"], tags: ["roguelike", "deckbuilder"], description: "A roguelike deckbuilder about rolling dice and chasing a million points. Draft dice, rings and cards, build explosive combos and push your luck one roll further." },
	"The Man From The Window 2": { developer: ["Zed_Technician"], porters: ["dude"], tags: ["horror", "indie"], description: "The sequel to the mascot horror hit. The man outside the window is back, and this time the night is longer. Short and jump-scare heavy." },
	Fez: { developer: ["Polytron"], porters: ["gurtmuncher"], tags: ["platformer", "puzzle"], description: "A calm platformer built around turning a 3D world. Rotate the perspective to line up platforms and collect cubes across a serene, pixel-art landscape." },
	Beatblock: { developer: ["BubbleTabby"], porters: ["sunsuke"], tags: ["rhythm", "music"], description: "A rhythm game where the beat spins around you. Hit blocks to the music as the paddle-wielding Cranky, with challenge songs, a marathon mode and a level editor." },
	Azahar: { developer: ["Azahar"], porters: ["sexyplankton"], tags: ["emulator", "nintendo"], description: "A Nintendo 3DS emulator, born from the Citra and Lime3DS projects. Load your own 3DS dumps and play them in the browser." },
	Ravenfield: { developer: ["SteelRaven7"], porters: ["gurtmuncher"], tags: ["shooter", "sandbox"], description: "A large-scale, low-poly first-person shooter sandbox. Two bot armies fight across open maps, and you set the weapons, vehicles and rules." },
	"Happy Room": { developer: ["Mana Potion Studios"], porters: ["gurtmuncher"], tags: ["physics", "sandbox"], description: "A physics playground for test dummies. Set traps, spikes and hazards, then watch the ragdolls meet their end in increasingly silly ways." },
	Inscryption: { developer: ["Daniel Mullins Games"], porters: ["reeyuki"], tags: ["roguelike", "horror"], description: "A deckbuilding roguelike wrapped in an escape-room horror. Beat your host at cards, and the cabin around the table slowly gives up its secrets." },
	"Lobotomy Corporation": { developer: ["Project Moon"], porters: ["reeyuki"], tags: ["management", "horror"], description: "A management sim about containing monsters. Run an energy company staffed by eldritch abnormalities, assign employees, and survive each day." },
	"Ages of Conflict": { developer: ["JoySpark Games"], porters: ["sexyplankton"], tags: ["simulation", "strategy"], description: "A world-war simulator. Paint nations onto a map, set them loose, and watch AI armies form, fight and collapse in an endless contest of borders." },
	"While True: Learn()": { developer: ["Luden.io"], porters: ["dasher"], tags: ["puzzle", "programming"], description: "A puzzle game about making a machine learn. Route data, tune the flow and solve the problems of machine learning, with a cat who needs its mail fixed." },
	"Plauge Inc": { name: "Plague Inc", developer: ["Ndemic Creations"], porters: ["reeyuki"], tags: ["strategy", "simulation"], description: "Evolve a pathogen and wipe out humanity. Spread, mutate and outpace a world that is trying very hard to cure you." },
	"Trombone Champ": { developer: ["Holy Wow Studios"], porters: ["gurtmuncher"], tags: ["rhythm", "music"], description: "A rhythm game played on a trombone. Hit the notes, slide around, and forgive yourself for how it sounds." },
	"Granny 3": { developer: ["DVloper"], porters: ["crax"], tags: ["horror", "escape"], description: "Escape a creaky house while Granny and Grandpa hunt for the noise. Sneak, hide and find a way out before the days run out." },
	PEAK: { developer: ["Aggro Crab", "Landfall"], porters: ["dasher"], tags: ["co-op", "platformer"], description: "A co-op climbing game from the studios behind Going Under and Content Warning. Climb a mountain with friends, manage stamina, and help each other up." },
	"Among Us": { developer: ["Innersloth"], porters: [], tags: ["multiplayer", "deduction"], description: "A social-deduction party game. Fix the ship as a crewmate, or sabotage and murder as an impostor, while everyone argues about who is suspicious." },
	"GTA 3": { developer: ["Rockstar North"], porters: ["shxyder"], tags: ["open-world", "action"], description: "The open-world crime game that set the template. Work your way up Liberty City, driving, shooting and taking jobs across three islands." },
	"SCP: Containment Breach": { developer: ["Undertow Games"], porters: ["q8j"], tags: ["horror", "first-person"], description: "A first-person horror born from the SCP Foundation wiki. Containment has failed, and you are inside with things that should not be loose." },
	ClusterTruck: { developer: ["Landfall"], porters: ["NotRexed"], tags: ["platformer", "action"], description: "A first-person platformer where the ground is made of moving trucks. Keep moving, keep jumping, and try not to fall." },
	"How To Fish": { developer: ["Dazed Games"], porters: ["NotRexed"], tags: ["co-op", "fishing"], description: "A physics co-op fishing game. Cast, reel and slowly discover that the peaceful lake has more going on under the surface." },
	"Global Strike (CS 1.6)": { developer: ["Valve"], porters: ["crackers"], tags: ["shooter", "classic"], description: "A browser port of the classic tactical shooter: buy a gun, plant or defuse, and hold angles against bots. Counter-Strike 1.6, running in a tab." },
	"Lethal Company": { developer: ["Zeekerss"], porters: ["crax"], tags: ["co-op", "horror"], description: "A co-op scavenging horror. Land on moons, meet a quota of scrap, and try to get everyone back to the ship alive." },
	"Crashout Crew": { developer: ["Aggro Crab"], porters: ["x8r"], tags: ["co-op", "physics"], description: "A physics co-op comedy about forklifts. Fulfil warehouse orders with up to four players, stack the boxes, and try not to crash out." },
	Rimworld: { name: "RimWorld", developer: ["Ludeon Studios"], porters: ["sexyplankton"], tags: ["colony-sim", "strategy"], description: "A colony-building sim that generates its own stories. Crash-land with a few survivors, manage food, moods and raids, and keep them alive on a hostile planet." },
	"The Message From Deep space": { name: "The Message from Deep Space", image: "img/tmfds.jpg", developer: ["Applesinmypants"], porters: ["dasher"], tags: ["puzzle", "sci-fi"], description: "A sci-fi puzzle game set in 1973. A meteorite is broadcasting, and you must translate an alien message using only math and science." },
	"Dude, Stop": { developer: ["Team HalfBeard"], porters: ["dasher"], tags: ["puzzle", "comedy"], description: "A comedy puzzle game that punishes you for following the rules. Do the task, then do the opposite, and see what breaks." },
	"Kerbal Space Program": { developer: ["Squad"], porters: ["crackers"], tags: ["simulation", "space"], description: "Build a rocket, launch some brave green Kerbals, and learn real orbital mechanics the hard way. A sandbox space-program sim." },
	"Hill Climb Racing": { developer: ["Fingersoft"], porters: ["NotRexed"], tags: ["physics", "driving"], description: "A physics driving game about a car with more torque than sense. Climb hills, collect coins and try not to flip on your head." },
	Toasterball: { developer: ["Les Crafteurs"], porters: ["dasher"], tags: ["sports", "physics"], description: "A physics sports game where toasters are the athletes. Serve bread, spike it, and play solo or locally with up to four people." },
	Superflight: { developer: ["GrizzlyGames"], porters: ["zay"], tags: ["flying", "arcade"], description: "A wingsuit gliding game about flow. Fly through bright procedural canyons, skim the cliffs for points, and see how far you can go." },
	"Keep Talking And Nobody Explodes": { developer: ["Steel Crate Games"], porters: ["zay"], tags: ["puzzle", "party"], description: "A bomb-defusal party game. One person sees the bomb, everyone else has the manual, and nobody can look at both." },
	"Horsey Game": { developer: ["Captain Games"], porters: ["crackers"], tags: ["indie", "racing"], description: "A silly horse game. Breed, race and climb the ranks of the equestrian world, one improbably long horse at a time." },
	"There Is No Game: Wrong Dimension": { developer: ["Draw Me A Pixel"], porters: ["dasher"], tags: ["adventure", "comedy"], description: "A meta point-and-click that insists it has no game in it. Break the interface, argue with the narrator, and find the game anyway." },
};

// wasm.rip member -> GitHub, so the porter credit links somewhere real
const GITHUB: Record<string, string> = {
	shayder: "shayderrr", crackers: "woahhcrackers", cirsius: "cirsius", NotRexed: "NotRexed", q8j: "q8j-dev",
	sexyplankton: "SomeRandomFella", sunsuke: "a1pl", gurtmuncher: "gurtmuncher", reeyuki: "reeyuki",
	slqnt: "slqntdevss", dasher: "dashiellbenton", crax: "mynamescrax", x8r: "x8rr", zay: "squidward5",
};

interface Game {
	name: string;
	gameUrl: string;
	imageUrl: string;
	porter: string;
	featured?: boolean;
}

const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const games = (await (await fetch(`${SITE}/games.json`)).json()) as Game[];
const items: ImportItem[] = [];
const missing: string[] = [];
for (const game of games) {
	const meta = META[game.name];
	if (!meta) {
		missing.push(game.name);
		continue;
	}
	const url = /^https?:/.test(game.gameUrl) ? game.gameUrl : `${SITE}/${game.gameUrl}`;
	const thumb = meta.image ?? game.imageUrl;
	const image = /^https?:/.test(thumb) ? thumb : `${SITE}/${thumb}`;
	items.push({
		name: meta.name ?? game.name,
		url,
		summary: summarize(meta.description, game.name),
		description: meta.description,
		developers: meta.developer,
		porters: meta.porters.map((p) => ({ name: p, url: GITHUB[p] ? `https://github.com/${GITHUB[p]}` : undefined })),
		host: { name: "wasm.rip", url: "https://wasm.rip" },
		tags: meta.tags,
		category: "games",
		iconUrl: image,
		bannerUrl: image,
		notes: "A browser port by the wasm.rip team.",
		source: "wasmrip",
	});
}
if (missing.length) console.log(`! no metadata for: ${missing.join(", ")}`);

console.log(`${items.length} wasm.rip port${items.length === 1 ? "" : "s"}`);
await runImport(items, { dry: argv.includes("--dry"), only: opt("only") });
