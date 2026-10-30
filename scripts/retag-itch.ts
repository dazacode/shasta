#!/usr/bin/env bun
/**
 * Re-classifies the apps scripts/import-itch.ts already added. The first import trusted each author's "Visual Novel"
 * genre pick and kept only 8 tags (losing the engine), so ~7.1k games sat on the Visual novel shelf, many of them
 * Bitsy walks, Twine stories, 3D horror or platformers. This re-reads every game's itch.io page (the same listings
 * the import walks; cached in .cache/itch-games.json), decides with lib/itchClass.ts, and patches the tags: real
 * visual novels keep the shelf, everything else gets the genres its page names. Apps whose page is gone are decided
 * (and apps already tagged renpy) from their stored tags. Matched by the hosted build URL. Safe to re-run; only changed apps are patched.
 *
 *   bun scripts/retag-itch.ts [--dry] [--jobs 16] [--show 40]
 */
import { ITCH_SOURCE, factsFromTags, isVisualNovel, itchTags, type ItchFacts } from "./lib/itchClass";
import { ITCH, enumerate, scrapeAll, type Row } from "./lib/itchSource";
import { api, closeTunnel } from "./lib/storeImport";

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const num = (n: string, d: number) => {
	const i = argv.indexOf(`--${n}`);
	return (i >= 0 && Number(argv[i + 1])) || d;
};
const jobs = num("jobs", 16);
const show = num("show", 0);
const ROWS = ".cache/itch-rows.json";

// the import's default listings; the row list is cached too, so a re-run goes straight to the patching
const rowsFile = Bun.file(ROWS);
let rows: Row[] = (await rowsFile.exists()) ? await rowsFile.json() : [];
if (!rows.length) {
	for (const l of [`${ITCH}/games/genre-visual-novel/platform-web`, `${ITCH}/games/made-with-renpy/platform-web`]) rows.push(...(await enumerate(l)));
	const seen = new Set<string>();
	rows = rows.filter((r) => !seen.has(r.url) && !!seen.add(r.url));
	await Bun.write(ROWS, JSON.stringify(rows));
}
// only this import's apps (the marker alone: an app carrying a second source marker was merged by hand)
const itchApps = async () => {
	const { apps } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
	return { total: apps.length, targets: apps.filter((a) => (a.tags ?? []).includes(ITCH_SOURCE) && (a.tags as string[]).filter((t) => ["archive", "scratch", "obsidian", "gnmath"].includes(t)).length === 0) };
};
let { targets } = await itchApps();
closeTunnel(); // the page reads can take half an hour; no tunnel sits idle meanwhile

// read only the pages of games the Store has (the import named each app after the page title); the build URL then
// pairs page and app exactly. A game already tagged renpy is a visual novel whatever its page says, so its stored
// tags are enough (itch rate-limits to a few pages a second; this skips ~40% of them)
const key = (s: string) => s.slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g, "");
const names = new Set(targets.filter((a) => !(a.tags as string[]).includes("renpy")).map((a) => key(a.name)));
const pages = await scrapeAll(rows.filter((r) => names.has(key(r.title))), ".cache/itch-games.json", 8);
const byPlay = new Map<string, ItchFacts>();
for (const g of pages.values()) if (g) byPlay.set(g.playUrl, g);
const fresh = await itchApps(); // tags as they are now, not as they were before the reads
targets = fresh.targets;
console.log(`${targets.length} itch.io apps (of ${fresh.total} in the Store), ${byPlay.size} itch pages read`);

const stats = { fromPage: 0, fromTags: 0, vn: 0, other: 0, changed: 0, failed: 0 };
const samples: string[] = [];
let i = 0;
await Promise.all(
	new Array(jobs).fill(0).map(async () => {
		while (i < targets.length) {
			const app = targets[i++];
			const url: string = app.versions?.find((v: any) => v.current)?.linkedUrl ?? app.versions?.find((v: any) => v.linkedUrl)?.linkedUrl ?? "";
			const page = byPlay.get(url);
			const facts = page ?? factsFromTags(app.tags);
			page ? stats.fromPage++ : stats.fromTags++;
			const vn = isVisualNovel(facts);
			vn ? stats.vn++ : stats.other++;
			const keep = (app.tags as string[]).includes("fan-picked") ? ["fan-picked"] : [];
			const next = [...itchTags(facts).slice(0, 9 - keep.length), ...keep, ITCH_SOURCE];
			const current: string[] = app.tags ?? [];
			if (current.length === next.length && next.every((t) => current.includes(t))) continue;
			if (samples.length < show && !vn && current.includes("visual-novel")) samples.push(`  ${app.name}  [${facts.madeWith.join("/") || "?"}]  ->  ${next.slice(0, -1).join(", ")}`);
			try {
				if (!dry) await api("PATCH", `/api/dev/apps/${app.id}`, { json: { tags: next } });
				stats.changed++;
			} catch (e) {
				stats.failed++;
				if (stats.failed <= 20) console.log(`  ✗ ${app.name}: ${(e as Error).message}`);
			}
		}
	}),
);
closeTunnel();
if (samples.length) console.log(`\nleaving the Visual novel shelf (sample):\n${samples.join("\n")}`);
console.log(
	`\n${dry ? "[dry] " : ""}${stats.changed} retagged, ${stats.failed} failed · visual novels ${stats.vn}, other games ${stats.other} · decided from the page ${stats.fromPage}, from stored tags ${stats.fromTags}`,
);
if (stats.failed) process.exitCode = 1;
