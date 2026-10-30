#!/usr/bin/env bun
/**
 * Gives the open-source Store apps (the `openapp` source tag) real metadata: a 1280x720 screenshot of the LIVE app,
 * taken from its own Store origin, becomes the cover everywhere tiles/heroes show one — and the listing gets the
 * project's own one-liner as its summary/description. Downloadable packages carry no og:image the way linked apps do,
 * so this is how a package gets real art.
 *
 * It PATCHes metadata and POSTs a screenshot; it creates no new version, so it never touches the upload rate limit.
 * Needs Playwright's chromium (already a shasta dev dependency) and a reachable Store (the ssh tunnel like the import).
 *
 *   bun scripts/enrich-openapps.ts                 # metadata + a cover for every openapp app missing one
 *   bun scripts/enrich-openapps.ts --force          # replace existing covers too
 *   bun scripts/enrich-openapps.ts --only Snake
 *   bun scripts/enrich-openapps.ts --no-cover       # metadata only
 *   bun scripts/enrich-openapps.ts --no-meta        # covers only
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSources, toItem } from "./lib/openapps";
import { api, appPayload, closeTunnel } from "./lib/storeImport";

const root = path.resolve(import.meta.dir, "..");
const requireFromShasta = createRequire(path.join(root, "shasta/package.json"));
const sharp = () => requireFromShasta("sharp") as any;

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const only = opt("only")?.toLowerCase();
const force = flag("force");
const wantMeta = !flag("no-meta");
const wantCover = !flag("no-cover");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// tolerate small title differences ("Snakes and Ladders" vs "Snakes Ladders", "&" vs "and")
const loose = (s: string) =>
	s
		.toLowerCase()
		.replace(/\b(and|the|of|a)\b/g, "")
		.replace(/[^a-z0-9]/g, "");
const sources = await loadSources();
const byName = new Map(sources.map((s) => [norm(s.name), s]));
const byLoose = new Map(sources.map((s) => [loose(s.name), s]));
const findSource = (appName: string) => byName.get(norm(appName)) ?? byLoose.get(loose(appName));

interface Brief {
	id: string;
	slug: string;
	name: string;
	kind: string;
	tags: string[];
	screenshots: string[];
}
const { apps } = await api<{ apps: Brief[] }>("GET", "/api/dev/apps?all=1&brief=1");
const targets = apps.filter((a) => a.tags.includes("openapp") && a.kind === "package" && (!only || a.name.toLowerCase().includes(only)));
console.log(`${targets.length} openapp apps${only ? ` matching "${only}"` : ""}`);

const work = mkdtempSync(path.join(tmpdir(), "openapp-art-"));
let meta = 0;
let covers = 0;
let skipped = 0;

// ---- metadata (summary/description/tags/credits from the catalogue) ---------------------------------------------
if (wantMeta) {
	for (const a of targets) {
		const src = findSource(a.name);
		if (!src) continue;
		try {
			await api("PATCH", `/api/dev/apps/${a.id}`, { json: appPayload(toItem(src), a.name) });
			meta++;
		} catch (e) {
			console.log(`  ✗ meta ${a.name}: ${(e as Error).message}`);
		}
	}
	console.log(`metadata set on ${meta} apps`);
}

// ---- covers (a screenshot of the live app) ----------------------------------------------------------------------
if (wantCover) {
	const { chromium } = requireFromShasta("@playwright/test") as typeof import("@playwright/test");
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
	let i = 0;
	const worker = async () => {
		while (i < targets.length) {
			const a = targets[i++];
			if (!force && a.screenshots.length) {
				skipped++;
				continue;
			}
			let page;
			try {
				const { target } = await api<{ target: { url: string } }>("GET", `/api/apps/${a.slug}/launch`);
				page = await ctx.newPage();
				await page.goto(target.url, { waitUntil: "load", timeout: 25_000 }).catch(() => undefined);
				await page.waitForTimeout(1600); // let canvas/animation paint a first frame
				const png = await page.screenshot({ type: "png" });
				const file = path.join(work, `${a.id}.webp`);
				await sharp()(png).resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 82 }).toFile(file);
				await api("POST", `/api/dev/apps/${a.id}/screenshots`, { raw: readFileSync(file) });
				covers++;
				if (covers % 10 === 0) console.log(`  … ${covers} covers`);
			} catch (e) {
				console.log(`  ✗ cover ${a.name}: ${(e as Error).message}`);
			} finally {
				await page?.close().catch(() => undefined);
			}
		}
	};
	await Promise.all(new Array(Math.min(Number(opt("jobs")) || 3, targets.length || 1)).fill(0).map(worker));
	await browser.close();
	console.log(`covers added: ${covers}${skipped ? ` (${skipped} already had one)` : ""}`);
}

rmSync(work, { recursive: true, force: true });
closeTunnel();
console.log("\ndone");
