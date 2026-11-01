// Shared machinery for opium.best's CLOUD games.
//
// opium.best's "Cloud" section is a WebRTC game-streaming service ("stratus") on a set of public mirror
// hosts. It is open: no account, no key, CORS reflects the caller's origin. REA recovered the whole wire
// protocol from the site's own main.js (see opium-recon/README.md). Here we turn its catalogue into Store
// items and a self-contained player page, so each cloud game is a normal installable/downloadable app.
//
// Two delivery modes:
//   packages (default) -> each game is a one-file package (its own origin, sandboxed, downloadable) whose
//                         index.html is the cloud player with that game's key baked in.
//   linked             -> each game is a linked app that opens /opium-cloud.html?g=<key> (one shared page).
import { readFileSync } from "node:fs";
import path from "node:path";
import { packageFromHtml } from "./packageBuild";
import { cleanText, summarize, type ImportItem } from "./storeImport";

const root = path.resolve(import.meta.dir, "../..");
const PLAYER_TEMPLATE = path.join(root, "shasta/public/opium-cloud.html");

/** WISP mirror hosts the site rotates through; any one runs the same stratus API. */
export const MIRRORS = [
	"cdn.vipersfutbol.com",
	"cdn.northstreetumc.org",
	"cdn.pcesc.org",
	"cdn.kcchallengevbc.com",
	"cdn.slcbmooc.org",
	"cdn.topstargym.net",
	"cdn.goaplytexas.org",
	"cdn.clearfieldswimming.org",
	"cdn.richardacademy.cfd",
];

export interface CloudGame {
	key: string;
	name: string;
	image?: string;
	cover?: string;
	tags?: string[];
	description?: string;
}

/** First mirror that answers /stratus/status. */
export async function pickMirror(): Promise<string> {
	for (const h of MIRRORS) {
		try {
			const r = await fetch(`https://${h}/stratus/status`, { signal: AbortSignal.timeout(6000) });
			if (r.ok) return h;
		} catch {
			/* try the next */
		}
	}
	return MIRRORS[0];
}

/** The whole cloud catalogue (~208 titles). */
export async function fetchCloudGames(host?: string): Promise<{ host: string; games: CloudGame[] }> {
	const h = host ?? (await pickMirror());
	const r = await fetch(`https://${h}/stratus/games`, { signal: AbortSignal.timeout(30_000) });
	if (!r.ok) throw new Error(`${r.status} for /stratus/games on ${h}`);
	const j = (await r.json()) as { games?: CloudGame[] };
	return { host: h, games: (j.games ?? []).filter((g) => g && g.key && g.name) };
}

export const playerUrl = (origin: string, key: string) => `${origin.replace(/\/+$/, "")}/opium-cloud.html?g=${encodeURIComponent(key)}`;

/** Where the player should talk to. Omit for the built-in default (opium's /stratus mirrors). */
export interface CloudApi {
	/** e.g. https://stratus.example.com (no trailing slash). Empty = the built-in mirror list. */
	base?: string;
	/** "cloud/v1" for a self-hosted x8rr/stratus-api, "stratus" for the mirrors. */
	prefix?: string;
	/** x-api-key when the API requires one (stratus-api site key). */
	key?: string;
	/** where the browse page fetches its catalogue (stratus-api serves cloud.json at its root). */
	catalog?: string;
}

/** A one-file package: the player page with this game's key/name/cover baked in. */
export function buildPlayerPackage(g: CloudGame, api?: CloudApi | null): Uint8Array {
	const tpl = readFileSync(PLAYER_TEMPLATE, "utf8");
	const cfg = JSON.stringify({ key: g.key, name: g.name, cover: g.cover ?? g.image ?? null });
	const html = tpl.replace("/*__CONFIG__*/null", cfg).replace("/*__API__*/null", api ? JSON.stringify(api) : "null");
	return packageFromHtml(html, g.name);
}

export interface CloudItemOptions {
	/** public origin of the site, e.g. https://edushasta.lol */
	origin: string;
	mode: "packages" | "linked";
	/** point the app at a self-hosted API; omit for the built-in mirrors */
	api?: CloudApi | null;
}

/** Source descriptions carry 【Label】: and [Note] markers; make them read cleanly. */
const tidyBlurb = (s: string) =>
	cleanText(s)
		.replace(/【\s*([^】]*?)\s*】/g, "$1: ")
		.replace(/^\s*(introduction|intro|overview|about|note|notice|loading|tips?|how to play)\s*:\s*/i, "")
		.replace(/\s+/g, " ")
		.trim();

/** Map one stratus entry to a Store item. Reuses the source metadata (name/tags/description/art). */
export function itemFromGame(g: CloudGame, opts: CloudItemOptions): ImportItem {
	// " (Cloud)" so it is clear these stream from a remote PC rather than being a web port
	const name = `${(g.name || g.key).replace(/\s+/g, " ").trim().slice(0, 52)} (Cloud)`;
	const blurb = tidyBlurb(g.description || "");
	const tags = [...(g.tags ?? []).filter((t): t is string => typeof t === "string" && !!t.trim()), "cloud"];
	const description =
		`${blurb ? `${blurb} ` : ""}Streamed from the cloud: Shasta runs a remote gaming PC and pipes the picture back into the tab, ` +
		`so a full desktop title plays without a download. Click the picture to lock the pointer; keyboard and mouse (and a gamepad) control the game. ` +
		`Nothing to install, no account.`;
	return {
		name,
		// unique per game: used to keep two sources from listing the same URL twice
		url: opts.mode === "linked" ? playerUrl(opts.origin, g.key) : undefined,
		build: opts.mode === "packages" ? () => Promise.resolve(buildPlayerPackage(g, opts.api)) : undefined,
		summary: summarize(blurb, `${name} — a PC game streamed in the browser`),
		description,
		developers: [],
		porters: [{ name: "raccoongame", url: "https://www.raccoongame.com/" }],
		host: { name: "opium.best", url: "https://opium.best/" },
		tags,
		category: "games",
		iconUrl: g.image ?? g.cover,
		bannerUrl: g.cover ?? g.image,
		notes: `Cloud game (opium.best stratus, key ${g.key}). Runs in an iframe on its own origin; the stream comes over WebRTC.`,
		source: "opium-cloud",
	};
}
