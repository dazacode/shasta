#!/usr/bin/env bun
/**
 * Adds a curated batch of free, open-source browser games and small apps to the Shasta Store as PACKAGES (downloads).
 *
 * A package is zipped by us, hosted by Shasta and run from its own sandboxed origin, so it keeps working offline and
 * when a school filter blocks the game's original site. Credits stay with the original makers; the source repo is the
 * host. Everything is open-source (MIT / GPL / MPL) and downloadable as a source ZIP, so packaging is `index.html` at
 * the top level plus its own assets — nothing to build. The catalogue lives in scripts/lib/openapps.ts.
 *
 *   bun scripts/import-openapps.ts                 # publish everything to ssh://shasta
 *   bun scripts/import-openapps.ts --check         # download + run the Store's validator on every package, no upload
 *   bun scripts/import-openapps.ts --pending       # only finish what is missing (a re-run skips live apps)
 *   bun scripts/import-openapps.ts --dry           # list what would happen, no writes
 *   bun scripts/import-openapps.ts --only Pacman   # one app (name substring)
 *   bun scripts/import-openapps.ts --jobs 8
 *
 * Re-running updates our own apps only (the hidden `openapp` source tag); a same-named app from another source is
 * left alone. Downloads are cached in .cache/openapps/. Covers/metadata: `bun run enrich:openapps`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractPackage } from "../server/src/services/packages";
import { loadSources, toItem } from "./lib/openapps";
import { githubZip, packageFromUrl } from "./lib/packageBuild";
import { runImport } from "./lib/storeImport";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const SOURCES = await loadSources();
const wanted = SOURCES.filter((s) => !opt("only") || s.name.toLowerCase().includes(opt("only")!.toLowerCase()));

if (flag("help")) {
	console.log(`sources: ${SOURCES.length}\n  bun scripts/import-openapps.ts [--dry] [--only NAME] [--jobs N] [--pending] [--check]`);
	process.exit(0);
}

if (flag("check")) {
	// build every package and run the Store's own validator, so a big publish does not fail halfway
	let bad = 0;
	let i = 0;
	const run = async () => {
		while (i < wanted.length) {
			const s = wanted[i++];
			const dir = mkdtempSync(path.join(tmpdir(), "openapp-"));
			try {
				const zip = await packageFromUrl(githubZip(s.repo, s.branch), { dir: s.dir, rewrite: s.rewrite, includeRoot: s.includeRoot });
				const report = await extractPackage(Buffer.from(zip), dir);
				if (report.ok) console.log(`  ok   ${s.name} (${(zip.length / 1048576).toFixed(1)} MB, ${report.fileCount} files)`);
				else {
					bad++;
					console.log(`  FAIL ${s.name}: ${report.errors.slice(0, 4).join("; ")}`);
				}
			} catch (e) {
				bad++;
				console.log(`  FAIL ${s.name}: ${(e as Error).message}`);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	};
	await Promise.all(new Array(Math.min(Number(opt("jobs")) || 6, wanted.length)).fill(0).map(run));
	console.log(`\n${wanted.length - bad}/${wanted.length} packages pass the Store validator`);
	process.exit(bad ? 1 : 0);
}

console.log(`${wanted.length} open-source packages to import`);
await runImport(wanted.map(toItem), { dry: flag("dry"), only: opt("only"), jobs: Number(opt("jobs")) || 6, pending: flag("pending") });
