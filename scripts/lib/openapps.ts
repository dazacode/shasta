// The curated catalogue of free, open-source apps and games that Shasta packages as downloadable Store apps.
// Shared by scripts/import-openapps.ts (publish) and scripts/enrich-openapps.ts (art + real metadata).
import { fetchCached, githubZip, packageFromUrl, type ZipOptions } from "./packageBuild";
import type { ImportItem } from "./storeImport";

const GITHUB = "https://github.com";

export interface Source extends ZipOptions {
	name: string;
	summary: string;
	description: string;
	/** original makers, shown first */
	developer: string[];
	tags: string[];
	/** a Store category id; defaults to "games" */
	category?: string;
	repo: string;
	branch: string;
	license: string;
	credit?: { name: string; url?: string }[];
}

const CLASSICS: Source[] = [
	{
		name: "Hextris",
		summary: "A fast hex-grid twist on Tetris: rotate the wheel and clear the falling blocks before they pile up.",
		description: "Hextris is a rapid-fire arcade puzzle: a hexagon spins in the middle, coloured blocks fall inward, and you rotate the ring so matching colours meet and clear. Made at a hackathon and open-source ever since. Runs fully offline.",
		developer: ["Logan Engstrom", "Garrett Finucane", "Noah Moroze", "Michael Yang"],
		tags: ["puzzle", "arcade"],
		repo: "Hextris/hextris",
		branch: "gh-pages",
		license: "GPL-3.0",
	},
	{
		name: "A Dark Room",
		summary: "A minimalist text survival game that quietly grows into a whole world.",
		description: "A Dark Room starts with one line of text, a fire and a cold room, and opens out into a survival, building and exploration game with a story underneath. A landmark of minimalist browser games, and open-source. Runs fully offline.",
		developer: ["Michael Townsend"],
		tags: ["adventure", "survival", "text-adventure", "idle"],
		repo: "doublespeakgames/adarkroom",
		branch: "main",
		license: "MPL-2.0",
	},
	{
		name: "Cube Composer",
		summary: "A calm puzzle game about composing little functions that move and paint a cube.",
		description: "Cube Composer is a puzzle game that quietly teaches functional thinking: you assemble a program out of pieces to guide and paint a cube to its goal. Open-source and made by the author of the `fd` and `hyperfine` tools. Runs fully offline.",
		developer: ["David Peter"],
		tags: ["puzzle", "logic", "programming"],
		repo: "sharkdp/cube-composer",
		branch: "master",
		license: "MIT",
	},
	{
		name: "Tetris",
		summary: "The classic falling-blocks game, small and clean, by Jake Gordon.",
		description: "A faithful, open-source take on Tetris: rotate and drop the falling pieces, clear lines and speed up. Built as an HTML5 canvas game with keyboard and touch controls. Runs fully offline.",
		developer: ["Jake Gordon"],
		tags: ["puzzle", "arcade", "classic"],
		repo: "jakesgordon/javascript-tetris",
		branch: "master",
		license: "MIT",
	},
	{
		name: "HexGL",
		summary: "A slick futuristic racing game in WebGL, inspired by WipEout and F-Zero.",
		description: "HexGL is a fast anti-gravity racing game rendered in WebGL: boost down neon tracks, thread the corners and beat the lap time. A famous early WebGL showcase and open-source. Needs a reasonably recent browser. Runs fully offline.",
		developer: ["Thibaut Despoulain (BKcore)"],
		tags: ["racing", "arcade"],
		repo: "BKcore/HexGL",
		branch: "master",
		license: "MIT",
	},
	{
		name: "Clumsy Bird",
		summary: "A Flappy Bird-style endless flyer built on the melonJS engine.",
		description: "Tap to flap and thread Clumsy Bird through the pipes for as long as you can. A charming, open-source endless runner made with the melonJS engine, with day and night scenes. Runs fully offline.",
		developer: ["Ellison Leão"],
		tags: ["arcade", "endless-runner", "physics"],
		repo: "ellisonleao/clumsy-bird",
		branch: "master",
		license: "GPL-3.0",
	},
	{
		name: "Asteroids",
		summary: "The arcade classic: drift, shoot and break the rocks before they hit you.",
		description: "A canvas remake of the 1979 arcade game Asteroids — thrust, rotate, fire and split the drifting rocks while dodging them. Open-source and tiny. Runs fully offline.",
		developer: ["Doug McInnes"],
		tags: ["arcade", "shooter", "classic"],
		repo: "dmcinnes/HTML5-Asteroids",
		branch: "master",
		license: "MIT",
	},
	{
		name: "Racer",
		summary: "A pseudo-3D Out Run-style racing game on a winding road.",
		description: "An open-source tribute to the arcade racers of the 80s: a pseudo-3D road, hills and curves, and a car to steer around traffic at speed. Runs fully offline.",
		developer: ["Jake Gordon"],
		tags: ["racing", "arcade"],
		repo: "jakesgordon/javascript-racer",
		branch: "master",
		license: "MIT",
	},
	{
		name: "JS Paint",
		summary: "A loving remake of MS Paint, right down to the toolbox and the icons.",
		description: "JS Paint recreates the classic Microsoft Paint experience in the browser: pencil, brush, shapes, the colour palette, undo, zoom and even the old menus. Open-source and remarkably faithful. Runs fully offline.",
		developer: ["Isaiah Odhner"],
		tags: ["drawing", "art", "graphics-design", "design"],
		category: "productivity",
		repo: "1j01/jspaint",
		branch: "master",
		license: "MIT",
	},
	{
		name: "miniPaint",
		summary: "A small Photoshop-style image editor: layers, filters, selections and effects.",
		description: "miniPaint is a free, open-source image editor for the browser. Open a picture or start from blank, then use layers, selections, transforms, colour tools and filters, and save the result. Runs fully offline.",
		developer: ["ViliusL"],
		tags: ["photo", "drawing", "graphics-design", "design"],
		category: "productivity",
		repo: "viliusle/miniPaint",
		branch: "master",
		license: "MIT",
	},
	{
		name: "Vim",
		summary: "The real Vim, compiled to WebAssembly, in a tab.",
		description: "Vim, the editor, compiled to WebAssembly and running entirely in the browser. Open a file, use your real keybindings and :commands, and learn Vim without installing anything. Open-source. Runs fully offline.",
		developer: ["rhysd (Pocke)"],
		tags: ["developer-tools", "code", "coding"],
		category: "productivity",
		repo: "rhysd/vim.wasm",
		branch: "wasm",
		dir: "wasm",
		license: "MIT",
	},
	{
		name: "Calced",
		summary: "A notepad that does the maths as you type, line by line.",
		description: "Calced is a cross between a notepad and a calculator: type notes and sums, and it evaluates each line (including variables) as you go. Handy for homework and quick figuring. Open-source. Runs fully offline.",
		developer: ["Karl Bartel"],
		tags: ["productivity", "notes", "utilities"],
		category: "productivity",
		repo: "karlb/calced",
		branch: "master",
		dir: "web",
		license: "MIT",
	},
];

// The mashukui/web-games collection: single-file games, one repo, MIT. Tags mirror the collection's own categories.
const MASHUKUI_REPO = "mashukui/web-games";
export const MASHUKUI_GAMES: Record<string, string[]> = {
	"2048": ["puzzle", "logic"],
	"air-hockey": ["sports", "arcade", "local-multiplayer"],
	"ant-flap": ["arcade", "endless-runner"],
	"ant-jump": ["arcade", "platformer"],
	"balloon-pop": ["arcade", "casual"],
	"battleship": ["puzzle", "strategy", "board-game"],
	"block-drop": ["puzzle", "arcade"],
	"bowling": ["sports", "arcade"],
	"breakout": ["arcade", "classic"],
	"bubble-shooter": ["puzzle", "arcade"],
	"checkers": ["puzzle", "strategy", "board-game"],
	"connect-four": ["puzzle", "strategy", "board-game"],
	"cross-road": ["arcade", "action"],
	"dino-run": ["arcade", "endless-runner"],
	"fruit-slice": ["arcade", "action"],
	"gem-match": ["puzzle", "match-3"],
	"gomoku": ["puzzle", "strategy", "board-game"],
	"hanoi": ["puzzle", "logic"],
	"helicopter": ["arcade", "endless-runner"],
	"helix-drop": ["arcade", "endless-runner"],
	"hoop-shot": ["sports", "arcade"],
	"lights-out": ["puzzle", "logic"],
	"mahjong-link": ["puzzle", "match-3"],
	"mancala": ["puzzle", "strategy", "board-game"],
	"maze-muncher": ["arcade", "action"],
	"memory-match": ["puzzle", "casual"],
	"merge-drop": ["puzzle", "arcade"],
	"minesweeper": ["puzzle", "logic"],
	"mini-golf": ["sports", "arcade"],
	"nonogram": ["puzzle", "logic"],
	"paddle-duel": ["arcade", "local-multiplayer"],
	"penalty-kick": ["sports", "arcade"],
	"piano-tap": ["rhythm", "music", "arcade"],
	"pipe-connect": ["puzzle", "logic"],
	"reversi": ["puzzle", "strategy", "board-game"],
	"rush-hour": ["puzzle", "logic"],
	"simon-says": ["puzzle", "casual"],
	"slide-puzzle": ["puzzle", "logic"],
	"slingshot": ["arcade", "physics"],
	"snake": ["arcade", "classic"],
	"snakes-ladders": ["board-game", "casual"],
	"sokoban": ["puzzle", "logic"],
	"stack-tower": ["arcade", "casual"],
	"star-defender": ["arcade", "shooter"],
	"sudoku": ["puzzle", "logic"],
	"tic-tac-toe": ["puzzle", "board-game"],
	"water-sort": ["puzzle", "logic"],
	"whack-a-mole": ["arcade", "casual"],
};

const titleCase = (slug: string) => slug.replace(/-/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
const decode = (s: string) =>
	s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Each game's own one-liner and title, straight from the collection's README (never invented). */
async function mashukuiReadme(): Promise<Map<string, { name: string; summary: string; category: string }>> {
	const out = new Map<string, { name: string; summary: string; category: string }>();
	try {
		const md = new TextDecoder().decode(await fetchCached(`https://raw.githubusercontent.com/${MASHUKUI_REPO}/main/README.md`));
		for (const line of md.split("\n")) {
			if (!/^\|/.test(line)) continue;
			const c = line.split("|").map((s) => s.trim());
			const slug = /web-games\/([a-z0-9-]+)\//.exec(c[5] ?? "")?.[1];
			if (!slug || !c[1] || !c[4]) continue;
			out.set(slug, { name: decode(c[1].replace(/\*/g, "")), summary: decode(c[4]), category: c[3] ?? "" });
		}
	} catch {}
	return out;
}

/** Every source, with the mashukui entries carrying their real one-liners. */
export async function loadSources(): Promise<Source[]> {
	const readme = await mashukuiReadme();
	const mashukui: Source[] = Object.entries(MASHUKUI_GAMES).map(([slug, tags]) => {
		const r = readme.get(slug);
		const name = r?.name ?? titleCase(slug);
		const one = r?.summary;
		return {
			name,
			summary: one ?? `${name}, a small free browser game that runs offline.`,
			description: one
				? `${one} — ${name}, one of mashukui's free browser games. Packaged for Shasta so it runs offline from your device. Open-source (MIT).`
				: `${name} is one of mashukui's collection of quick, free browser games — just open it and play. Packaged for Shasta so it runs offline from your device. Open-source (MIT).`,
			developer: ["mashukui"],
			tags: [...tags, "casual"],
			repo: MASHUKUI_REPO,
			branch: "main",
			dir: slug,
			includeRoot: ["i18n.js"],
			rewrite: [
				["../i18n.js", "i18n.js"],
				['href="../"', 'href="./"'],
			],
			license: "MIT",
		};
	});
	return [...CLASSICS, ...mashukui];
}

export function toItem(s: Source): ImportItem {
	return {
		name: s.name,
		url: `${GITHUB}/${s.repo}`,
		summary: s.summary,
		description: s.description,
		developers: s.developer,
		porters: s.credit,
		host: { name: "GitHub", url: `${GITHUB}/${s.repo}` },
		tags: s.tags,
		category: s.category ?? "games",
		notes: `Free and open-source (${s.license}). Packaged to run offline in Shasta.`,
		source: "openapp",
		build: () => packageFromUrl(githubZip(s.repo, s.branch), { dir: s.dir, rewrite: s.rewrite, includeRoot: s.includeRoot }),
	};
}
