#!/usr/bin/env bun
/**
 * Cleans up the imported Internet Archive apps (scripts/lib/archiveClass.ts decides):
 *  - gives each one its classics genre (Arcade / Console / DOS & PC classics), its system and the real genres the
 *    Archive's metadata names, instead of the single "Retro & emulators" bucket;
 *  - unpublishes clutter: bad-dump variants, ROM hacks, demos, items MAME marks unplayable or mature
 *    (reversible: the app stays, `republish` brings one back).
 * Safe to re-run; only apps whose tags or status actually change are touched.
 *
 *   bun scripts/retag-archive.ts [--dry] [--limit N] [--jobs 16] [--keep-clutter]
 */
import { type ArchiveDoc, archiveIdOf, classify, fetchArchive } from "./lib/archiveClass";
import { api, closeTunnel } from "./lib/storeImport";

const COLLECTIONS = ["internetarcade", "consolelivingroom", "softwarelibrary_msdos_games"];
const argv = process.argv.slice(2);
const has = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const limit = Number(opt("limit")) || Infinity;
const dry = has("dry");

const docs = new Map<string, ArchiveDoc>();
for (const d of await fetchArchive(COLLECTIONS)) if (!docs.has(d.identifier)) docs.set(d.identifier, d);
console.log(`${docs.size} archive.org items indexed`);

const { apps } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
const targets = apps.filter((a) => (a.tags ?? []).includes("archive")).slice(0, limit);
console.log(`${targets.length} archive apps to check (of ${apps.length} in the Store)`);

let retagged = 0;
let hidden = 0;
let failed = 0;
let i = 0;
const why = new Map<string, number>();
const t0 = Date.now();
await Promise.all(
	new Array(Number(opt("jobs")) || 16).fill(0).map(async () => {
		while (i < targets.length) {
			const app = targets[i++];
			const url = app.versions?.find((v: any) => v.current)?.linkedUrl ?? app.versions?.find((v: any) => v.linkedUrl)?.linkedUrl ?? "";
			const id = archiveIdOf(url);
			if (!id) continue;
			const r = classify(docs.get(id) ?? { identifier: id }, app.name);
			try {
				if (r.clutter && !has("keep-clutter")) {
					if (app.status !== "published") continue;
					why.set(r.clutter.replace(/:.*/, ""), (why.get(r.clutter.replace(/:.*/, "")) ?? 0) + 1);
					if (!dry) await api("POST", `/api/dev/apps/${app.id}/unpublish`);
					hidden++;
					continue;
				}
				const next = [...r.tags, "archive"];
				const current: string[] = app.tags ?? [];
				if (current.length === next.length && next.every((t) => current.includes(t))) continue;
				if (!dry) await api("PATCH", `/api/dev/apps/${app.id}`, { json: { tags: next } });
				retagged++;
			} catch (e) {
				failed++;
				if (failed <= 20) console.log(`  ✗ ${app.name}: ${(e as Error).message}`);
			}
			if (i % 2000 === 0) console.log(`  … ${retagged} retagged, ${hidden} unpublished (${i}/${targets.length})`);
		}
	})
);
closeTunnel();
console.log(`\n${dry ? "[dry] " : ""}${retagged} retagged, ${hidden} unpublished as clutter, ${failed} failed · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
for (const [k, n] of why) console.log(`  ${k}: ${n}`);
if (failed) process.exitCode = 1;
