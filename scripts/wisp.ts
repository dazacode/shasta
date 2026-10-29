// Wisp housekeeping for the `wisp/` submodule.
//
// The relay lives in its own public repository (github.com/dazacode/shasta-wisp, see FORK.md
// there) and is pinned here as a git submodule at `wisp/`. `wisp.pin` names the tag.
//
//   bun run wisp status        where the relay is (tag, commit, clean?)
//   bun run wisp setup         check out the pinned relay (submodule update --init)
//   bun run wisp verify        assert the pin is intact and the checkout is clean
//   bun run wisp sync          fetch the fork and check out the tag in wisp.pin
//   bun run wisp reset         throw away local edits inside wisp/
//   bun run wisp bump <tag>    move the pin to another tag and stage the gitlink
//   bun run wisp test          run the fork's own test suite
//
// Unlike the engine there is no build step: the fork is plain JavaScript, so the submodule's
// commit is the whole artefact and a pin bump needs no restamp. See docs/on-device-wisp.md.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const WISP = join(ROOT, "wisp");
const PIN = join(ROOT, "wisp.pin");

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

const pin = () => (existsSync(PIN) ? readFileSync(PIN, "utf8").trim().split(/\s+/)[0] : fail("wisp.pin is missing"));
const head = () => out(["rev-parse", "HEAD"], WISP);
/** The commit the superproject records for the submodule: what a fresh clone would get. */
function recorded(): string {
	const line = out(["ls-files", "-s", "wisp"]).split("\n")[0] ?? "";
	const fromIndex = line.split(/\s+/)[1];
	if (fromIndex) return fromIndex;
	return out(["rev-parse", "HEAD:wisp"]);
}
const tag = () => out(["describe", "--exact-match", "--tags", "HEAD"], WISP) || "(not a tag)";
const dirty = () => out(["status", "--porcelain"], WISP).length > 0;

function status() {
	if (!existsSync(join(WISP, "src"))) fail("wisp/ is empty. Run: bun run wisp setup");
	console.log(`pin file      ${pin()}`);
	console.log(`checked out   ${head()}`);
	console.log(`tag           ${tag()}`);
	console.log(`recorded      ${recorded()}`);
	console.log(`clean         ${dirty() ? "no — local edits inside wisp/" : "yes"}`);
}

function verify() {
	const problems: string[] = [];
	if (!existsSync(join(WISP, "src"))) problems.push("wisp/ is not checked out (run: bun run wisp setup)");
	else {
		if (head() !== recorded()) problems.push(`the submodule is at ${head().slice(0, 10)} but the superproject records ${recorded().slice(0, 10)}`);
		if (tag() !== pin()) problems.push(`the submodule is at ${tag()} but wisp.pin says ${pin()}`);
		if (dirty()) problems.push("wisp/ has local modifications (run: bun run wisp reset)");
	}
	if (problems.length) {
		console.error("wisp verification failed:");
		for (const problem of problems) console.error(`  - ${problem}`);
		process.exit(1);
	}
	console.log(`wisp ok: ${pin()} (${head().slice(0, 10)}), clean`);
}

const mode = process.argv[2] ?? "status";

if (mode === "status") status();
else if (mode === "verify") verify();
else if (mode === "setup") {
	git(["submodule", "update", "--init", "--recursive"]);
	const install = Bun.spawnSync(["bun", "install"], { cwd: WISP, stdio: ["inherit", "inherit", "inherit"] });
	if (install.exitCode !== 0) fail("bun install failed in wisp/");
	verify();
} else if (mode === "sync") {
	git(["fetch", "--tags"], WISP);
	git(["checkout", "--quiet", pin()], WISP);
	if (!existsSync(join(WISP, "node_modules"))) Bun.spawnSync(["bun", "install"], { cwd: WISP, stdio: ["inherit", "inherit", "inherit"] });
	verify();
} else if (mode === "reset") {
	git(["checkout", "--", "."], WISP);
	git(["clean", "-fd"], WISP);
	verify();
} else if (mode === "bump") {
	const next = process.argv[3] ?? fail("usage: bun run wisp bump <tag>");
	git(["fetch", "--tags"], WISP);
	git(["checkout", "--quiet", next], WISP);
	writeFileSync(PIN, `${next}\n`);
	git(["add", "wisp", "wisp.pin"]);
	console.log(`pin moved to ${next} (${head().slice(0, 10)}); commit the staged gitlink`);
} else if (mode === "test") {
	if (!existsSync(join(WISP, "node_modules"))) {
		console.log("installing the fork's dependencies…");
		const install = Bun.spawnSync(["bun", "install"], { cwd: WISP, stdio: ["inherit", "inherit", "inherit"] });
		if (install.exitCode !== 0) fail("bun install failed in wisp/");
	}
	const proc = Bun.spawnSync(["node", "--test", "test/"], { cwd: WISP, stdio: ["inherit", "inherit", "inherit"] });
	process.exit(proc.exitCode ?? 1);
} else {
	fail("usage: bun run wisp <status|setup|verify|sync|reset|bump <tag>|test>");
}
