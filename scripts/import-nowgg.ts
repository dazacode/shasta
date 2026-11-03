#!/usr/bin/env bun
/**
 * Adds every now.gg cloud GAME to the Shasta Store as its own app.
 *
 * Each entry becomes a one-file PACKAGE (its own origin, sandboxed, downloadable) whose index.html is the now.gg
 * player with that game's appId baked in. Metadata comes from each game's own now.gg page (cached in
 * .cache/nowgg-pages.json): the real write-up, the 16:9 banner, sub-genres. now.gg's own pages, Android apps
 * (TikTok, Temu, AI photo tools) and duplicate entries are left out (see selectGames in scripts/lib/nowgg.ts).
 * Source tag "nowgg" marks our rows, so re-runs update them.
 *
 *   bun scripts/import-nowgg.ts [--dry] [--report] [--only "roblox|gacha"] [--jobs 8] [--origin https://edushasta.lol]
 *                               [--catalog path|url] [--refresh-pages] [--pending]
 *   --report   print what would be listed / left out (and why), with sample descriptions; changes nothing
 *   --replace  first REMOVE every existing "nowgg" app that is not in the new list (old names, duplicates, non-games)
 */
import path from "node:path";
import { fetchCatalog, fetchPages, itemFromGame, selectGames, type NowggApp } from "./lib/nowgg";
import { api, closeTunnel, norm, runImport } from "./lib/storeImport";

const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const origin = opt("origin") ?? process.env.VITE_SITE_ORIGIN ?? "https://edushasta.lol";

// live catalogue, else the snapshot `fetch:nowgg` saved
let apps: NowggApp[] = await fetchCatalog().catch(async (e) => {
	const snap = path.resolve(import.meta.dir, "../data/nowgg-catalog.json");
	console.warn(`live catalogue failed (${(e as Error)?.message ?? e}); using the snapshot ${snap}`);
	return ((await Bun.file(snap).json()) as { apps: NowggApp[] }).apps;
});
const catalog = opt("catalog");
if (catalog) {
	const from = /^https?:/.test(catalog) ? await fetch(catalog).then((r) => r.json()) : await Bun.file(catalog).json();
	apps = (Array.isArray(from) ? from : from.apps ?? []) as NowggApp[];
}
apps = apps.filter((a) => a && a.appId && (a.appName || a.media));

const pages = await fetchPages(apps, { refresh: argv.includes("--refresh-pages") });
const { kept, dropped } = selectGames(apps, pages);
console.log(`${apps.length} now.gg entries → ${kept.length} games, ${dropped.length} left out · origin=${origin}`);
const items = kept.map((g) => itemFromGame(g, { origin }));

if (argv.includes("--report")) {
	const why = new Map<string, string[]>();
	for (const d of dropped) {
		const k = d.why.startsWith("duplicate") ? "duplicate entry" : d.why;
		why.set(k, [...(why.get(k) ?? []), `${d.app.appName} [${d.app.appId}]`]);
	}
	for (const [k, v] of why) console.log(`\nleft out — ${k} (${v.length}):\n  ${v.join("\n  ")}`);
	const renamed = kept.filter((g) => g.name !== g.app.appName);
	console.log(`\nrenamed (${renamed.length}):\n  ${renamed.map((g) => `${g.app.appName} → ${g.name}`).join("\n  ")}`);
	const thin = items.filter((i) => !pages.get(String(kept[items.indexOf(i)].app.appId))?.overview);
	console.log(`\nno write-up on now.gg (${thin.length}), first: ${thin.slice(0, 8).map((i) => i.name).join(", ")}`);
	console.log(`no banner: ${items.filter((i) => !i.bannerUrl).length}, no icon: ${items.filter((i) => !i.iconUrl).length}`);
	for (const i of items.filter((x) => /^(case simulator|rally racer dirt|geometry dash|mini golf tour|the sims freeplay|flame keeper)$/i.test(x.name)).slice(0, 6))
		console.log(`\n=== ${i.name} · ${i.developers.join(", ")} · tags ${i.tags.join(" ")}\nsummary: ${i.summary}\n${i.description}\nbanner: ${i.bannerUrl}\nicon: ${i.iconUrl}`);
	process.exit(0);
}

if (argv.includes("--replace") && !argv.includes("--dry")) {
	// retire every earlier nowgg row the new list does not reuse: the old " (now.gg)" names, duplicates, non-games.
	// "removed" is reversible (owner restore), and runImport ignores removed rows.
	const { apps: live } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
	// the name each item will really get: runImport adds " (now.gg)" only when ANOTHER source already has the name
	const others = new Set(live.filter((a) => !(a.tags ?? []).includes("nowgg") && a.status !== "removed").map((a) => norm(a.name)));
	const keep = new Set(items.map((i) => (others.has(norm(i.name)) ? norm(`${i.name} (now.gg)`) : norm(i.name))));
	const old = live.filter((a) => (a.tags ?? []).includes("nowgg") && a.status !== "removed");
	const seen = new Set<string>();
	const reused: any[] = [];
	const gone = old.filter((a) => {
		const k = norm(a.name);
		if (!keep.has(k) || seen.has(k)) return true; // not in the new list, or a second row with that name
		seen.add(k);
		reused.push(a);
		return false;
	});
	// a reused row still shows the old portrait tile: drop it so the import adds the real banner
	for (const a of reused) for (const f of a.screenshots ?? []) await api("DELETE", `/api/dev/apps/${a.id}/screenshots/${encodeURIComponent(f)}`).catch(() => undefined);
	console.log(`reusing ${reused.length} earlier now.gg rows, removing ${gone.length} of ${old.length}…`);
	let n = 0;
	await Promise.all(
		new Array(8).fill(0).map(async () => {
			while (gone.length) {
				const a = gone.pop()!;
				await api("DELETE", `/api/dev/apps/${a.id}?reason=${encodeURIComponent("now.gg re-import: replaced")}`).catch((e) => console.log(`  ✗ ${a.name}: ${(e as Error).message}`));
				if (++n % 200 === 0) console.log(`  … ${n}`);
			}
		}),
	);
	closeTunnel();
}

await runImport(items, {
	dry: argv.includes("--dry"),
	only: opt("only"),
	jobs: Number(opt("jobs")) || undefined,
	pending: argv.includes("--pending"),
	collisionSuffix: opt("suffix") ?? " (now.gg)",
});
