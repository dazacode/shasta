// Publishes the open-source `shasta` CLI to its public repository: `bun run publish:cli [--dry-run]`.
// The CLI is developed here (server/cli/: shasta.ts, lib/, docs, examples) next to the server it talks to; the
// public repo is a generated copy. lib/packageCheck.ts there is the server's own validator
// (server/src/services/packageCheck.ts), so `shasta check` and the upload route can never disagree.
// Steps: clone the public repo, replace its files with this tree, smoke-test it from a clean install, commit, push.
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const CLI = path.join(root, "server/cli");
const REPO = process.env.SHASTA_CLI_REPO ?? "dazacode/shasta-cli";
const dry = process.argv.includes("--dry-run");

function run(cmd: string[], cwd: string, quiet = false) {
	if (!quiet) console.log(`\x1b[36m> ${cmd.join(" ")}\x1b[0m`);
	const p = Bun.spawnSync(cmd, { cwd, stdio: ["inherit", quiet ? "pipe" : "inherit", "inherit"] });
	if (p.exitCode !== 0) {
		console.error(`\x1b[31mfailed: ${cmd.join(" ")} (exit ${p.exitCode})\x1b[0m`);
		process.exit(1);
	}
	return p.stdout?.toString() ?? "";
}

const stage = mkdtempSync(path.join(tmpdir(), "shasta-cli-"));
run(["git", "clone", "--quiet", `git@github.com:${REPO}.git`, stage], root);
for (const f of readdirSync(stage)) if (f !== ".git") rmSync(path.join(stage, f), { recursive: true, force: true });

// the tree
cpSync(path.join(CLI, "shasta.ts"), path.join(stage, "shasta.ts"));
cpSync(path.join(CLI, "lib"), path.join(stage, "lib"), { recursive: true });
cpSync(path.join(root, "server/src/services/packageCheck.ts"), path.join(stage, "lib/packageCheck.ts"));
for (const f of ["README.md", "PUBLISHING.md", "RULES.md"]) cpSync(path.join(CLI, f), path.join(stage, f));
cpSync(path.join(CLI, "examples"), path.join(stage, "examples"), { recursive: true });
cpSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));

const server = JSON.parse(readFileSync(path.join(root, "server/package.json"), "utf8"));
const sha = run(["git", "rev-parse", "--short", "HEAD"], root, true).trim();
const version = JSON.parse(readFileSync(path.join(root, "shasta/package.json"), "utf8")).version;
writeFileSync(
	path.join(stage, "package.json"),
	JSON.stringify(
		{
			name: "shasta-cli",
			version,
			description: "Publish games and web apps to the Shasta Store from the terminal: init, check, preview, apply, publish.",
			license: "AGPL-3.0-only",
			type: "module",
			bin: { shasta: "shasta.ts" },
			files: ["shasta.ts", "lib", "examples", "README.md", "PUBLISHING.md", "RULES.md", "LICENSE"],
			engines: { bun: ">=1.1" },
			repository: { type: "git", url: `https://github.com/${REPO}` },
			dependencies: { fflate: server.dependencies.fflate },
		},
		null,
		2,
	) + "\n",
);
writeFileSync(path.join(stage, ".gitignore"), "node_modules/\n");
writeFileSync(
	path.join(stage, "tsconfig.json"),
	JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: ["bun"] }, include: ["shasta.ts", "lib"] }, null, "\t") + "\n",
);

// nothing private may leave: no server internals beyond the validator, no keys
const leaks = Bun.spawnSync(["grep", "-rlE", "BACKEND_KEY=[A-Za-z0-9]|BEGIN (RSA |EC |)PRIVATE KEY|\\.\\./\\.\\./src|from \"\\.\\./src", stage, "--exclude-dir=.git"]).stdout.toString().trim();
if (leaks) {
	console.error(`\x1b[31mrefusing to publish, check these files:\n${leaks}\x1b[0m`);
	process.exit(1);
}

// smoke test from a clean install, as a stranger would run it
run(["bun", "install", "--silent"], stage);
run(["bun", "shasta.ts", "help"], stage, true);
const report = JSON.parse(run(["bun", "shasta.ts", "check", "examples/hello-game", "--json"], stage, true));
if (!report.ok) {
	console.error("\x1b[31mthe example does not pass its own check\x1b[0m", report.findings);
	process.exit(1);
}
rmSync(path.join(stage, "node_modules"), { recursive: true, force: true });
rmSync(path.join(stage, "bun.lock"), { force: true });

run(["git", "add", "-A"], stage);
const changed = run(["git", "status", "--porcelain"], stage, true).trim();
if (!changed) {
	console.log("\x1b[32mthe public CLI is already up to date\x1b[0m");
	process.exit(0);
}
console.log(changed);
if (dry) {
	console.log(`\n--dry-run: staged in ${stage}, not pushed`);
	process.exit(0);
}
run(["git", "checkout", "--quiet", "-B", "main"], stage);
run(["git", "commit", "--quiet", "-m", `shasta-cli ${version} (Shasta ${sha})`], stage);
run(["git", "push", "--quiet", "origin", "main"], stage);
rmSync(stage, { recursive: true, force: true });
console.log(`\n\x1b[32mpublished: https://github.com/${REPO}\x1b[0m`);
