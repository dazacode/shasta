#!/usr/bin/env bun
/**
 * Re-reads every store.app page and fixes the tags of the apps already imported from it (the import used to miss
 * hyphenated categories such as developer-tools and graphics-design, leaving ~190 apps untagged, so they had no topic).
 * Only apps whose tags actually change are patched; matched by name, like the import.
 *
 *   bun scripts/retag-storeapp.ts [--dry]
 */
import { api, closeTunnel, norm, tagify } from "./lib/storeImport";

const SITE = "https://store.app";
const dry = process.argv.includes("--dry");

const sitemap = await (await fetch(`${SITE}/apps/sitemap.xml`)).text();
const slugs = [...sitemap.matchAll(/<loc>https:\/\/store\.app\/([^<]+)<\/loc>/g)].map((m) => m[1]).filter((s) => s && !s.includes("/"));
console.log(`${slugs.length} store.app entries`);

const catsByName = new Map<string, string[]>();
let i = 0;
await Promise.all(
	new Array(10).fill(0).map(async () => {
		while (i < slugs.length) {
			const slug = slugs[i++];
			try {
				const html = await (await fetch(`${SITE}/${slug}`, { signal: AbortSignal.timeout(30000) })).text();
				const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
				const name = ld ? (JSON.parse(ld) as { name?: string }).name?.trim().slice(0, 60) : null;
				if (!name) continue;
				const cats = [...new Set([...html.matchAll(/href="\/browse\/all\/([a-z_-]+)"/g)].map((m) => m[1]).filter((c) => c !== "games"))];
				if (cats.length && !catsByName.has(norm(name))) catsByName.set(norm(name), cats);
			} catch {}
		}
	}),
);
console.log(`${catsByName.size} pages with categories`);

const { apps } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
let changed = 0;
let failed = 0;
for (const app of apps.filter((a) => (a.tags ?? []).includes("storeapp"))) {
	const cats = catsByName.get(norm(app.name));
	if (!cats) continue;
	const current: string[] = app.tags;
	// keep any tag added by hand, add the page's categories
	const next = tagify([...cats.slice(0, 4), ...current.filter((t) => t !== "storeapp")], ["storeapp"]);
	if (next.length === current.length && next.every((t) => current.includes(t))) continue;
	try {
		if (!dry) await api("PATCH", `/api/dev/apps/${app.id}`, { json: { tags: next } });
		changed++;
	} catch (e) {
		failed++;
		console.log(`  ✗ ${app.name}: ${(e as Error).message}`);
	}
}
closeTunnel();
console.log(`${dry ? "[dry] " : ""}${changed} apps retagged, ${failed} failed`);
