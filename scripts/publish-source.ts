// Publishes the source of Shasta to its public repository: `bun run publish:source [--dry-run]`.
// Shasta is developed in a private tree; the public repo is a generated snapshot of it, and it is the source
// offer AGPL section 13 requires of a hosted copy (Settings -> About links there via VITE_SOURCE_URL).
// The snapshot is stamped with the commit and version it came from (SOURCE.md), so "the source of the version
// you are using" is checkable, not a claim: nothing here is a reimplementation.
// Steps: create the repo if missing, clone it, replace its files with this tree, write README/SOURCE.md, commit, push.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const REPO = process.env.SHASTA_SOURCE_REPO ?? "dazacode/shasta";
const URL = `https://github.com/${REPO}`;
const HOSTED = process.env.SHASTA_HOSTED_URL ?? "https://shasta-dtg.pages.dev";
const DESCRIPTION = "The source of Shasta: a browser that runs inside a browser tab, with a Store of games and apps. Published at each release (AGPL-3.0).";
const dry = process.argv.includes("--dry-run");

/** Files that belong in the snapshot but not in a public repository. */
const SKIP = new Set(["promptclaude.rtf"]);

/**
 * Kept back so a competitor cannot simply lift everything. What is published is the source of the
 * *browser* — the part that contains Scramjet, which is what the licence requires. What is not:
 *  - `server/`  the Store backend, a separate program that runs on our own machines;
 *  - `docs/`, `CLAUDE.md`, `.claude/`  our engineering notes ("how we did it");
 *  - `.github/`, the Dockerfile  CI and the backend image.
 * Build scripts *are* published: AGPL "Corresponding Source" includes the scripts that control compilation.
 */
const EXCLUDE = ["server/", "docs/", "CLAUDE.md", ".claude/", ".github/", "Dockerfile", ".dockerignore"];
const excluded = (f: string) => EXCLUDE.some((e) => (e.endsWith("/") ? f.startsWith(e) : f === e));

function run(cmd: string[], cwd: string, quiet = false) {
	if (!quiet) console.log(`\x1b[36m> ${cmd.join(" ")}\x1b[0m`);
	const p = Bun.spawnSync(cmd, { cwd, stdio: ["inherit", quiet ? "pipe" : "inherit", "inherit"] });
	if (p.exitCode !== 0) {
		console.error(`\x1b[31mfailed: ${cmd.join(" ")} (exit ${p.exitCode})\x1b[0m`);
		process.exit(1);
	}
	return p.stdout?.toString() ?? "";
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

// The snapshot is exactly what this tree has that git does not ignore (so no .env, data/, node_modules or build output).
const files = [
	...lines(run(["git", "ls-files"], root, true)),
	...lines(run(["git", "ls-files", "--others", "--exclude-standard"], root, true)),
].filter((f) => f !== "scramjet" && f !== "wisp" && !SKIP.has(f) && !excluded(f)); // the two submodules are re-created as gitlinks below

const submodules = lines(run(["git", "ls-files", "--stage"], root, true))
	.filter((l) => l.split(/\s+/)[0] === "160000")
	.map((l) => {
		const [mode, sha, , p] = l.split(/\s+/);
		return { mode, sha, path: p };
	});

const sha = run(["git", "rev-parse", "HEAD"], root, true).trim();
const version = JSON.parse(readFileSync(path.join(root, "shasta/package.json"), "utf8")).version;
const engine = readFileSync(path.join(root, "engine.pin"), "utf8").trim();
const wisp = readFileSync(path.join(root, "wisp.pin"), "utf8").trim();
const dirty = run(["git", "status", "--porcelain"], root, true).trim().length > 0;

if (Bun.spawnSync(["gh", "repo", "view", REPO], { cwd: root, stdout: "pipe", stderr: "pipe" }).exitCode !== 0) {
	console.log(`\x1b[33m${REPO} does not exist yet; creating it (public)\x1b[0m`);
	run(["gh", "repo", "create", REPO, "--public", "--description", DESCRIPTION], root);
}

const stage = mkdtempSync(path.join(tmpdir(), "shasta-source-"));
run(["git", "clone", "--quiet", `git@github.com:${REPO}.git`, stage], root);
for (const f of readdirSync(stage)) if (f !== ".git") rmSync(path.join(stage, f), { recursive: true, force: true });

// the tree, file by file, so the snapshot is the tracked set and nothing else
for (const rel of files) {
	const dest = path.join(stage, rel);
	mkdirSync(path.dirname(dest), { recursive: true });
	cpSync(path.join(root, rel), dest);
}

// public clones have no SSH keys: the submodules are the public forks, and are declared with https
const gitmodules = readFileSync(path.join(root, ".gitmodules"), "utf8").replaceAll("git@github.com:", "https://github.com/");
writeFileSync(path.join(stage, ".gitmodules"), gitmodules);

writeFileSync(
	path.join(stage, "SOURCE.md"),
	`# Source of the hosted Shasta

| | |
|---|---|
| Hosted instance | ${HOSTED} |
| Shasta version | ${version} |
| Published from | commit \`${sha}\`${dirty ? " (plus uncommitted work at publish time)" : ""} |
| Published on | ${new Date().toISOString().slice(0, 10)} |
| Scramjet engine | https://github.com/dazacode/shasta-scramjet, tag \`${engine}\` (submodule \`scramjet/\`) |
| Wisp relay | https://github.com/dazacode/shasta-wisp, tag \`${wisp}\` (submodule \`wisp/\`) |

Shasta is a browser built on [Scramjet](https://github.com/MercuryWorkshop/scramjet). Scramjet is
AGPL-3.0, so a hosted copy must let its users get the corresponding source of the version they are
using. This repository is that source: published from our development tree at the commit above, so
it is the real code and not a re-implementation of it. (Our own production bundle is minified and
obfuscated for size; the code here is what it is built from.)

Included: the browser, its Scramjet integration, the build scripts, and the engine and relay forks
as submodules. Not included: anything that only exists to serve Shasta from our own machines (the
Store backend, deployment notes, CI), and generated output.

To build the browser from here:

\`\`\`sh
git clone --recursive ${URL} && cd shasta
bun install
bun run build     # builds the engine (Rust) and the browser
\`\`\`

Under AGPL section 13 the offer has to stay good for as long as a copy is hosted. It does: this
repository is regenerated and pushed by \`bun run publish:source\` on each release, and the deployed
instance links to it (Settings → About → Source code).
`,
);

writeFileSync(
	path.join(stage, "README.md"),
	`# Shasta — browser source

Shasta is a browser that runs inside a browser tab: a desktop-style window with tabs, an omnibox,
bookmarks, history, downloads and settings, on top of the
[Scramjet](https://github.com/MercuryWorkshop/scramjet) interception proxy. It ships a curated
**Store** of games and web apps that install with one click and run sandboxed on their own address.

This repository is the **source of the browser**, published from our development tree at each
release because Scramjet is AGPL-3.0 and a hosted copy has to offer its source. See
[SOURCE.md](SOURCE.md) for the exact commit a deployment is built from, and [NOTICE.md](NOTICE.md)
for the licence and third-party components.

- Hosted: <${HOSTED}> · beta · AGPL-3.0-only ([LICENSE](LICENSE))
- Bugs, game requests and publishing: the Shasta Discord (this is not where development happens)
- The Store command line is its own project: [dazacode/shasta-cli](https://github.com/dazacode/shasta-cli)

## What is here

| Path | |
|---|---|
| \`shasta/\` | The browser: React + TypeScript + Vite, the shell, the Store, and the Scramjet integration |
| \`scramjet/\` | The engine fork, as a submodule (tagged \`${engine}\`) |
| \`wisp/\` | The relay fork, as a submodule (tagged \`${wisp}\`) |
| \`scripts/\` | The build scripts |
| \`apps/\` | First-party browser apps |

Not here: the Store **backend** (a separate program, \`server/\`), our deployment/engineering notes,
and anything generated.

## Build

Needs [Bun](https://bun.sh) >= 1.1, a Rust toolchain with the \`wasm32\` target, and \`pnpm\`.

\`\`\`sh
git clone --recursive ${URL} && cd shasta
bun install
bun run build        # builds the engine (Rust) and the browser -> shasta/dist
cd shasta && bun run preview
\`\`\`

\`bun run dev\` / \`bun run start\` also bring up a Wisp server; the full setup additionally expects the
Store backend, which is why it lives in the same tree during development but is not published here.

## Licence and credits

Shasta is AGPL-3.0-only. Browsing is powered by [Scramjet](https://github.com/MercuryWorkshop/scramjet)
by the Mercury Workshop team, together with their Wisp protocol and \`libcurl-transport\` /
\`epoxy-transport\` packages; those are AGPL-3.0 and are included through the two submodules above.
[NOTICE.md](NOTICE.md) lists every third-party component shipped in the browser bundle and its
licence, and [LICENSE](LICENSE) holds the full AGPL text.
`,
);

// nothing private may leave: no real .env values, no keys. The placeholders in .env.example and this
// script's own grep pattern always match, so they are dropped from the list.
const leaks = lines(
	run(
		["grep", "-rlE", "BEGIN ([A-Z]+ )?PRIVATE KEY|CLOUDFLARE_API_TOKEN=|KOFI_VERIFICATION_TOKEN=[^[:space:]]", stage, "--exclude-dir=.git"],
		root,
		true,
	),
)
	.map((f) => path.relative(stage, f))
	.filter((f) => f !== ".env.example" && f !== "scripts/publish-source.ts");
if (leaks.length) {
	console.error(`\x1b[33mcheck these files for real secrets:\n  ${leaks.join("\n  ")}\x1b[0m`);
}
if (files.includes(".env")) {
	console.error("\x1b[31m.env is in the snapshot; it should be gitignored\x1b[0m");
	process.exit(1);
}

run(["git", "add", "-A"], stage);
// re-create the two submodule gitlinks in the index (there is no checked-out submodule directory in the stage)
for (const s of submodules) run(["git", "update-index", "--add", "--cacheinfo", `${s.mode},${s.sha},${s.path}`], stage);

const changed = run(["git", "status", "--porcelain"], stage, true).trim();
if (!changed) {
	console.log(`\x1b[32mthe public source is already up to date (${sha.slice(0, 7)})\x1b[0m`);
	process.exit(0);
}
console.log(changed);
if (dry) {
	console.log(`\n--dry-run: staged in ${stage}, not pushed`);
	process.exit(0);
}
run(["git", "checkout", "--quiet", "-B", "main"], stage);
run(["git", "commit", "--quiet", "-m", `Shasta ${version} source (${sha.slice(0, 7)})${dirty ? " + local changes" : ""}`], stage);
run(["git", "push", "--quiet", "origin", "main"], stage);
rmSync(stage, { recursive: true, force: true });
console.log(`\n\x1b[32mpublished: ${URL}\x1b[0m`);
