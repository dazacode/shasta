// Engine housekeeping for the Scramjet submodule.
//
// The engine lives in its own repository (github.com/dazacode/shasta-scramjet, see FORK.md
// there) and is pinned here as a git submodule at `scramjet/`. The pin is the engine version:
// nothing in this repository patches, forks or rewrites Scramjet at build time any more.
//
//   bun run engine status        where the engine is (tag, commit, clean?, built?)
//   bun run engine setup         check out the pinned engine (submodule update --init)
//   bun run engine verify        assert the pin is intact and the checkout is clean
//   bun run engine sync          fetch the fork and check out the tag in engine.pin
//   bun run engine reset         throw away local edits inside scramjet/
//   bun run engine bump <tag>    move the pin to another tag and stage the gitlink
//   bun run engine build         force a rebuild (scripts/run.ts does this on its own)
//
// None of these touch shasta/ or the server. See docs/engine.md for the rollback procedure.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRAMJET = join(ROOT, "scramjet");
const PIN = join(ROOT, "engine.pin");
const STAMP = join(ROOT, "data/engine-built");

function fail(message: string): never {
	console.error(`\n\x1b[31m${message}\x1b[0m`);
	process.exit(1);
}

function git(args: string[], cwd = ROOT, tolerate = false) {
	const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0 && !tolerate) fail(`git ${args.join(" ")} failed:\n${proc.stderr.toString().trim()}`);
	return proc;
}

const out = (args: string[], cwd = ROOT) => git(args, cwd, true).stdout.toString().trim();
const ok = (args: string[], cwd = ROOT) => git(args, cwd, true).exitCode === 0;

const pin = () => (existsSync(PIN) ? readFileSync(PIN, "utf8").trim().split(/\s+/)[0] : fail("engine.pin is missing"));
const head = () => out(["rev-parse", "HEAD"], SCRAMJET);
/** The commit the superproject records for the submodule: what a fresh clone would get. */
function recorded(): string {
	// the index, not HEAD: this has to work before the gitlink has been committed too
	const line = out(["ls-files", "-s", "scramjet"]).split("\n")[0] ?? "";
	const fromIndex = line.split(/\s+/)[1];
	if (fromIndex) return fromIndex;
	return out(["rev-parse", "HEAD:scramjet"]);
}
const tag = () => out(["describe", "--exact-match", "--tags", "HEAD"], SCRAMJET) || "(not a tag)";
const dirty = () => out(["status", "--porcelain"], SCRAMJET).length > 0;

function built(): boolean {
	try {
		return readFileSync(STAMP, "utf8").trim() === head();
	} catch {
		return false;
	}
}

function status() {
	if (!existsSync(join(SCRAMJET, "packages"))) fail("scramjet/ is empty. Run: bun run engine setup");
	console.log(`pin file      ${pin()}`);
	console.log(`checked out   ${head()}`);
	console.log(`tag           ${tag()}`);
	console.log(`recorded      ${recorded()}`);
	console.log(`clean         ${dirty() ? "no — local edits inside scramjet/" : "yes"}`);
	console.log(`built         ${built() ? "yes" : "no (scripts/run.ts builds on demand)"}`);
}

function verify() {
	const problems: string[] = [];
	if (!existsSync(join(SCRAMJET, "packages"))) problems.push("scramjet/ is not checked out (run: bun run engine setup)");
	else {
		if (head() !== recorded()) problems.push(`the submodule is at ${head().slice(0, 10)} but the superproject records ${recorded().slice(0, 10)}`);
		if (tag() !== pin()) problems.push(`the submodule is at ${tag()} but engine.pin says ${pin()}`);
		if (dirty()) problems.push("scramjet/ has local modifications (run: bun run engine reset)");
	}
	if (problems.length) {
		console.error("engine verification failed:");
		for (const problem of problems) console.error(`  - ${problem}`);
		process.exit(1);
	}
	console.log(`engine ok: ${pin()} (${head().slice(0, 10)}), clean`);
}

const mode = process.argv[2] ?? "status";

if (mode === "status") status();
else if (mode === "verify") verify();
else if (mode === "setup") {
	git(["submodule", "update", "--init", "--recursive"]);
	verify();
} else if (mode === "sync") {
	git(["fetch", "--tags"], SCRAMJET);
	git(["checkout", "--quiet", pin()], SCRAMJET);
	verify();
} else if (mode === "reset") {
	git(["checkout", "--", "."], SCRAMJET);
	git(["clean", "-fd"], SCRAMJET);
	verify();
} else if (mode === "bump") {
	const next = process.argv[3] ?? fail("usage: bun run engine bump <tag>");
	git(["fetch", "--tags"], SCRAMJET);
	git(["checkout", "--quiet", next], SCRAMJET);
	writeFileSync(PIN, `${next}\n`);
	git(["add", "scramjet", "engine.pin"]);
	console.log(`pin moved to ${next} (${head().slice(0, 10)}); commit the staged gitlink`);
} else if (mode === "build") {
	const proc = Bun.spawnSync(["bun", "scripts/run.ts", "build"], { cwd: ROOT, stdio: ["inherit", "inherit", "inherit"] });
	process.exit(proc.exitCode ?? 1);
} else {
	fail("usage: bun run engine <status|setup|verify|sync|reset|bump <tag>|build>");
}
