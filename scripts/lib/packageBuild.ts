// Turn a third-party source (a release/source ZIP, or one HTML page) into a ZIP the Store accepts as a `package`
// app: index.html at the top level, only allowed file types, no dotfiles (the Store refuses hidden files) and no
// server scripts. Used by scripts/import-openapps.ts; the same rules live in server/src/services/packageCheck.ts.
//
// Kept generic so a new source only supplies: a URL, where the app's root is inside the archive, which files to copy
// from the archive root (e.g. a shared script a sub-folder page reaches with "../x.js"), and string rewrites for the
// paths that change once the app is lifted to its own root.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const requireFromShasta = createRequire(path.join(root, "shasta/package.json"));
const { unzipSync, zipSync } = requireFromShasta("fflate") as typeof import("fflate");

const CACHE = path.join(root, ".cache/openapps");

/** Exactly packageCheck.ts ALLOWED_EXT: keeping anything else here means the upload would be refused. */
const ALLOWED_EXT = new Set([
	"html", "htm", "js", "mjs", "css", "json", "map", "txt", "md", "xml", "csv", "tsv", "webmanifest", "wasm",
	"png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico", "cur",
	"mp3", "ogg", "oga", "wav", "m4a", "aac", "flac", "opus", "mp4", "webm", "ogv", "m4v", "mov",
	"woff", "woff2", "ttf", "otf", "eot",
	"glb", "gltf", "bin", "data", "mem", "pck", "unityweb", "br", "gz", "atlas", "skel", "fnt", "tmx", "tsx", "ktx", "ktx2", "basis", "hdr", "dds", "obj", "mtl", "pvr", "bundle", "symbols", "yaml", "yml",
	"kel", "aubrey", "hero", "omori", "pluto", "rpgmvp", "rpgmvo", "tps", "au", "ini", "lib", "dll", "so", "node", "dylib", "valve", "xlsx", "zip", "exe",
]);
/** Files whose real bytes are executables but belong in the package: the shebang sniff must not drop them. */
const NATIVE_EXT = new Set(["dll", "so", "node", "lib", "dylib", "valve", "exe"]);
/** Already-compressed: stored in the new ZIP instead of deflated again (matches the Store's own bundler). */
const STORED_EXT = new Set([
	"wasm", "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "cur",
	"mp3", "ogg", "oga", "wav", "m4a", "aac", "flac", "opus", "mp4", "webm", "ogv", "m4v", "mov",
	"woff", "woff2", "ttf", "otf", "eot", "glb", "gltf", "zip", "br", "gz", "flac",
]);
/** Text files a rewrite pass can safely edit. */
const TEXT_EXT = new Set(["html", "htm", "js", "mjs", "css", "json", "map", "txt", "md", "xml", "csv", "tsv", "webmanifest", "svg"]);

const JUNK = (p: string) =>
	p.startsWith("__MACOSX/") || p.endsWith(".DS_Store") || p.endsWith("Thumbs.db") || p.endsWith("desktop.ini");

const extOf = (name: string) => {
	const base = name.slice(name.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};
const isShebang = (b: Uint8Array) => b.length >= 2 && b[0] === 0x23 && b[1] === 0x21;

export interface ZipOptions {
	/** inside the archive: the folder that holds index.html (lifted to the package root) */
	dir?: string;
	/** literal text replacements, applied to text files (e.g. ["../i18n.js", "i18n.js"]) */
	rewrite?: readonly (readonly [string, string])[];
	/** files to copy from the archive ROOT into the package root, whatever `dir` is */
	includeRoot?: readonly string[];
}

/** One self-contained HTML page becomes a one-file package. */
export function packageFromHtml(html: string, title = "App"): Uint8Array {
	const page = /<html[\s>]/i.test(html)
		? html
		: `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title.replace(/</g, "&lt;")}</title>\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
	return zipSync({ "index.html": new TextEncoder().encode(page) }) as unknown as Uint8Array;
}

/** Normalise an archive into a Store package: root index.html, allowed types only, no dotfiles, no scripts. */
export function packageFromZip(raw: Uint8Array, opts: ZipOptions = {}): Uint8Array {
	const all = unzipSync(new Uint8Array(raw));
	const has = (n: string) => Object.prototype.hasOwnProperty.call(all, n);

	let wrapper = "";
	// strip a single wrapping folder ("repo-main/") that GitHub and Finder add, then apply `dir` inside it
	if (!has("index.html")) {
		const tops = new Set<string>();
		for (const n of Object.keys(all)) if (n && !n.endsWith("/")) tops.add(n.split("/")[0]);
		if (tops.size === 1) wrapper = `${[...tops][0]}/`;
	}
	const prefix = wrapper + (opts.dir ? `${opts.dir.replace(/^\/+|\/+$/g, "")}/` : "");
	if (!has(`${prefix}index.html`)) throw new Error(`no index.html at "${prefix}index.html" in the archive`);

	const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
	const seen = new Set<string>();
	for (const [rawName, data] of Object.entries(all)) {
		let name = rawName.replace(/^\.\//, "");
		if (!name || name.endsWith("/") || JUNK(name)) continue;
		if (prefix) {
			if (!name.startsWith(prefix)) continue;
			name = name.slice(prefix.length);
		}
		if (!name) continue;
		if (name.split("/").some((s) => s.startsWith("."))) continue; // dotfiles and dot-dirs
		const ext = extOf(name);
		if (ext && !ALLOWED_EXT.has(ext)) continue;
		if (!NATIVE_EXT.has(ext) && isShebang(data)) continue;
		const lower = name.toLowerCase();
		if (seen.has(lower)) continue;
		seen.add(lower);
		let bytes: Uint8Array = data;
		if (opts.rewrite?.length && TEXT_EXT.has(ext)) {
			let text = new TextDecoder().decode(data);
			for (const [from, to] of opts.rewrite) text = text.split(from).join(to);
			bytes = new TextEncoder().encode(text);
		}
		files[name] = STORED_EXT.has(ext) ? [bytes, { level: 0 }] : bytes;
	}

	for (const name of opts.includeRoot ?? []) {
		const data = all[wrapper + name] ?? all[name];
		if (!data) continue;
		files[name] = STORED_EXT.has(extOf(name)) ? [data, { level: 0 }] : data;
	}

	if (!files["index.html"]) throw new Error("the archive has no index.html at its top level after normalising");
	return zipSync(files, { level: 6 }) as unknown as Uint8Array;
}

/** Download with a small on-disk cache, so re-runs do not re-fetch tens of megabytes. */
export async function fetchCached(url: string, timeoutMs = 180_000): Promise<Uint8Array> {
	mkdirSync(CACHE, { recursive: true });
	const key = createHash("sha1").update(url).digest("hex").slice(0, 16);
	const base = path.basename(new URL(url).pathname) || "download";
	const file = path.join(CACHE, `${key}-${base}`);
	if (existsSync(file)) return new Uint8Array(readFileSync(file));
	const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "shasta-store-import" }, signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	writeFileSync(file, bytes);
	return bytes;
}

/** A URL that is a .zip (release asset, GitHub source archive) or a single HTML page, turned into a package. */
export async function packageFromUrl(url: string, opts: ZipOptions = {}): Promise<Uint8Array> {
	const buf = await fetchCached(url);
	if (buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b) return packageFromZip(buf, opts);
	const text = new TextDecoder().decode(buf);
	if (/<(!doctype|html|head|body|canvas)\b/i.test(text)) return packageFromHtml(text);
	throw new Error(`neither a ZIP nor an HTML page: ${url}`);
}

/** GitHub's source archive of a branch (`owner/repo` -> the repo's code, as a ZIP). */
export const githubZip = (repo: string, branch: string) => `https://github.com/${repo}/archive/refs/heads/${branch}.zip`;
