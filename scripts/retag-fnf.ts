#!/usr/bin/env bun
/**
 * Fixes the apps scripts/import-fnf.ts already added: the FNF portals also host .io shooters, Fireboy & Watergirl,
 * Sprunki and the like, and the first import tagged all of them as FNF, so ~2.4k games sat in Music & rhythm.
 * lib/fnfClass.ts decides from the name and game URL: real FNF mods keep the FNF/rhythm tags, Sprunki becomes its own
 * music tag, every other game gets the genre tags its name points to. Also moves the hidden source marker from "fnf"
 * (now a content tag) to "fnfportal", so later imports still recognise these apps as theirs.
 * Safe to re-run; only apps whose tags actually change are patched.
 *
 *   bun scripts/retag-fnf.ts [--dry] [--jobs 16]
 */
import { FNF_SOURCE, fnfKind, fnfTags } from "./lib/fnfClass";
import { api, closeTunnel } from "./lib/storeImport";

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const jobsAt = argv.indexOf("--jobs");
const jobs = (jobsAt >= 0 && Number(argv[jobsAt + 1])) || 16;

const { apps } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
// only apps still carrying the import's marker: one curated by hand (marker removed, e.g. the official LE SSERAFIM
// collab) is left alone, and so are gn-math's FNF games. The 2026-10-29 run already moved every app off the old "fnf" marker.
const targets = apps.filter((a) => (a.tags ?? []).includes(FNF_SOURCE));
console.log(`${targets.length} apps from the FNF portals (of ${apps.length} in the Store)`);

const kinds = { fnf: 0, sprunki: 0, other: 0 };
let changed = 0;
let failed = 0;
let i = 0;
await Promise.all(
	new Array(jobs).fill(0).map(async () => {
		while (i < targets.length) {
			const app = targets[i++];
			const url = app.versions?.find((v: any) => v.current)?.linkedUrl ?? app.versions?.find((v: any) => v.linkedUrl)?.linkedUrl ?? "";
			const kind = fnfKind(app.name, url);
			kinds[kind]++;
			const next = [...fnfTags(app.name, url), ...((app.tags as string[]).includes("fan-picked") ? ["fan-picked"] : []), FNF_SOURCE];
			const current: string[] = app.tags ?? [];
			if (current.length === next.length && next.every((t) => current.includes(t))) continue;
			if (dry && kind === "other") console.log(`  ${app.name}  ->  ${next.slice(0, -1).join(", ")}`);
			try {
				if (!dry) await api("PATCH", `/api/dev/apps/${app.id}`, { json: { tags: next } });
				changed++;
			} catch (e) {
				failed++;
				if (failed <= 20) console.log(`  ✗ ${app.name}: ${(e as Error).message}`);
			}
		}
	}),
);
closeTunnel();
console.log(`\n${dry ? "[dry] " : ""}${changed} retagged, ${failed} failed · FNF ${kinds.fnf}, Sprunki ${kinds.sprunki}, other games ${kinds.other}`);
if (failed) process.exitCode = 1;
