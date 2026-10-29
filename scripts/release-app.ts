// Publish a new version of the installed app (the signed .swbn): `bun run release:app [--dry-run]`.
//
// Builds Shasta (with the root .env, which bun loads when this runs from the root), bundles and signs it
// (scripts/build-iwa.ts), then uploads to the GitHub release that hosts it:
//   shasta-<version>.swbn   the versioned file (update.json points here)
//   shasta.swbn             the stable alias the download button uses (VITE_APP_BUNDLE_URL)
//   update.json             uploaded last, so it never points at a file that is not there yet
// A version that is already on the release is refused: raise shasta/package.json's version first.
// --dry-run builds everything and stops before uploading.

import { cpSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const REPO = process.env.SHASTA_RELEASE_REPO ?? "dazacode/shasta-releases";
const TAG = process.env.SHASTA_RELEASE_TAG ?? "app-latest";
const BASE_URL = process.env.IWA_BASE_URL ?? `https://github.com/${REPO}/releases/download/${TAG}/`;
const PUBLISH = join(ROOT, ".iwa/publish");
const dryRun = process.argv.includes("--dry-run");

function fail(message: string): never {
	console.error(`\n\x1b[31m${message}\x1b[0m`);
	process.exit(1);
}

function run(label: string, cmd: string[], cwd = ROOT, extra: Record<string, string> = {}) {
	console.log(`\n\x1b[36m> ${label}\x1b[0m`);
	const proc = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...extra }, stdio: ["inherit", "inherit", "inherit"] });
	if (proc.exitCode !== 0) fail(`${label} failed (exit ${proc.exitCode})`);
}

const VERSION = JSON.parse(readFileSync(join(ROOT, "shasta/package.json"), "utf8")).version;
const file = `shasta-${VERSION}.swbn`;

if (!existsSync(join(ROOT, ".iwa/shasta.swbn-key.pem"))) {
	// build-iwa would make a new key, i.e. a new app origin: installed copies would never update to it
	fail(".iwa/shasta.swbn-key.pem is missing: restore the backup (the key is the app's identity); not releasing");
}
if (!Bun.which("gh")) fail("Missing `gh` (GitHub CLI): brew install gh, then gh auth login");

const listed = Bun.spawnSync(["gh", "release", "view", TAG, "--repo", REPO, "--json", "assets", "-q", ".assets[].name"], { stdout: "pipe", stderr: "pipe" });
if (listed.exitCode !== 0) fail(`cannot read release ${TAG} on ${REPO}: ${listed.stderr.toString().trim()}`);
if (listed.stdout.toString().split("\n").includes(file)) {
	const message = `${file} is already published: raise the version in shasta/package.json first`;
	if (!dryRun) fail(message);
	console.warn(`\x1b[33m${message}\x1b[0m`);
}

if (!process.env.VITE_APP_API_ORIGIN) {
	console.warn("\x1b[33mVITE_APP_API_ORIGIN is not set: the app's Store and Wikipedia lookup will not work in this release.\x1b[0m");
}
if (!process.env.VITE_APP_BUNDLE_URL?.startsWith(BASE_URL)) {
	console.warn(`\x1b[33mVITE_APP_BUNDLE_URL does not point into ${BASE_URL}: the web build's download button may link elsewhere.\x1b[0m`);
}

run("build Shasta", ["bun", "run", "build"], join(ROOT, "shasta"));
run("bundle and sign the app", ["bun", "scripts/build-iwa.ts"], ROOT, { IWA_BASE_URL: BASE_URL });
cpSync(join(PUBLISH, file), join(PUBLISH, "shasta.swbn"));

if (dryRun) {
	console.log(`\n--dry-run: ${PUBLISH} holds ${file}, shasta.swbn, update.json; nothing uploaded`);
	process.exit(0);
}

run(`upload ${file}`, ["gh", "release", "upload", TAG, "--repo", REPO, join(PUBLISH, file)]);
run("update the stable alias", ["gh", "release", "upload", TAG, "--repo", REPO, "--clobber", join(PUBLISH, "shasta.swbn")]);
run("update update.json", ["gh", "release", "upload", TAG, "--repo", REPO, "--clobber", join(PUBLISH, "update.json")]);
console.log(`\n\x1b[32mreleased ${VERSION}: ${BASE_URL}shasta.swbn\x1b[0m`);
