// Builds the holiday photos listed in shasta/src/lib/seasonalPhotos.ts into shasta/public/seasonal/ (committed, so a
// normal build never needs the network). Downloads each ORIGINAL from Wikimedia Commons, refuses it unless its sha1
// matches the recorded one, and writes <id>.webp (1920 px) and <id>-sm.webp (960 px).
//   bun run build:seasonal            only missing files
//   bun run build:seasonal --force    redo all
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { SEASONAL_PHOTOS } from "../shasta/src/lib/seasonalPhotos";

const root = path.resolve(import.meta.dir, "..");
// sharp is installed in shasta/ (the emulator icons use it the same way)
const sharp = createRequire(path.join(root, "shasta/package.json"))("sharp");
const out = path.join(root, "shasta/public/seasonal");
const force = process.argv.includes("--force");
const UA = "ShastaBuild/1.0 (https://github.com/dazacode/shasta; seasonal photos)";

mkdirSync(out, { recursive: true });
for (const p of SEASONAL_PHOTOS) {
	const big = path.join(out, `${p.id}.webp`);
	const small = path.join(out, `${p.id}-sm.webp`);
	if (!force && existsSync(big) && existsSync(small)) {
		console.log(`= ${p.id}`);
		continue;
	}
	const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.file.replaceAll(" ", "_"))}`;
	const res = await fetch(url, { headers: { "User-Agent": UA } });
	if (!res.ok) throw new Error(`${p.id}: ${res.status} from ${url}`);
	const data = Buffer.from(await res.arrayBuffer());
	const sha1 = createHash("sha1").update(data).digest("hex");
	if (sha1 !== p.sha1) throw new Error(`${p.id}: sha1 ${sha1}, expected ${p.sha1} (the file on Commons changed: check it, then update seasonalPhotos.ts)`);
	writeFileSync(big, await sharp(data).rotate().resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 60, smartSubsample: true }).toBuffer());
	writeFileSync(small, await sharp(data).rotate().resize({ width: 960 }).webp({ quality: 68 }).toBuffer());
	console.log(`+ ${p.id}`);
}
